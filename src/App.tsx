import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, isCloudConfigured } from "./lib/supabase";

type Assignee = "나" | "배우자" | "함께";
type Kind = "일정" | "할 일";
type Entry = { id: string; title: string; date: string; time?: string; kind: Kind; assignee: Assignee; category: string; done: boolean; note?: string };
const STORAGE_KEY = "our-calendar-entries-v1";
const categories = ["이사", "집", "금융", "일", "개인", "기타"];
const today = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const seed: Entry[] = [
  { id: "e1", title: "도배", date: "2026-10-27", kind: "일정", assignee: "함께", category: "이사", done: false },
  { id: "e2", title: "입주 청소", date: "2026-10-29", kind: "일정", assignee: "함께", category: "이사", done: false },
  { id: "e3", title: "잔금 및 입주", date: "2026-10-30", kind: "일정", assignee: "함께", category: "금융", done: false },
  { id: "e4", title: "포장이사", date: "2026-11-02", time: "08:00", kind: "일정", assignee: "함께", category: "이사", done: false },
  { id: "e5", title: "보리와 새집 이동", date: "2026-11-02", time: "오후", kind: "일정", assignee: "함께", category: "이사", done: false },
  { id: "e6", title: "욕실 조명 LED 교체", date: "2026-10-30", kind: "할 일", assignee: "배우자", category: "집", done: false },
];
const categoryClass = (category: string) => ({ "이사": "moving", "집": "home", "금융": "money", "일": "work", "개인": "personal", "기타": "other" }[category] || "other");

export default function App() {
  const [entries, setEntries] = useState<Entry[]>(() => {
    try { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved) as Entry[] : seed; } catch { return seed; }
  });
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(dateKey(today));
  const [filter, setFilter] = useState<"전체" | Assignee>("전체");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [form, setForm] = useState({ title: "", date: dateKey(today), time: "", kind: "일정" as Kind, assignee: "함께" as Assignee, category: "이사", note: "" });
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) { setHousehold(null); setCloudError(""); }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) { setHousehold(null); return; }
    let cancelled = false;
    (async () => {
      setCloudError("");
      const { data: membership, error: membershipError } = await supabase!
        .from("household_members").select("household_id").eq("user_id", session.user.id).limit(1).maybeSingle();
      if (cancelled) return;
      if (membershipError) { setCloudError("클라우드 설정을 확인해 주세요. Supabase SQL 설정이 완료되었는지 확인해 주세요."); return; }
      if (!membership) { setHousehold(null); return; }
      const { data: home, error: homeError } = await supabase!
        .from("households").select("id,name,login_name").eq("id", membership.household_id).maybeSingle();
      if (cancelled) return;
      if (homeError || !home) { setCloudError("공유 캘린더 정보를 불러오지 못했어요."); return; }
      setHousehold(home as Household);
    })();
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (!supabase || !session || !household) return;
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase!.from("entries").select("*")
        .eq("household_id", household.id).order("date").order("time");
      if (cancelled) return;
      if (error) { setCloudError("일정을 불러오지 못했어요. 네트워크와 Supabase 설정을 확인해 주세요."); return; }
      const cloudEntries: Entry[] = (data || []).map((row: any) => ({
        id: String(row.id), title: row.title, date: row.date, time: row.time || "",
        kind: row.kind, assignee: row.assignee, category: row.category || "기타",
        done: Boolean(row.done), note: row.note || ""
      }));
      if (cloudEntries.length === 0 && localEntriesRef.current.length > 0 &&
          window.confirm("클라우드 캘린더가 비어 있어요. 이 기기에 저장된 기존 일정 " + localEntriesRef.current.length + "개를 클라우드로 가져올까요?")) {
        const rows = localEntriesRef.current.map(e => cloudRow(e, household.id, session.user.id));
        const { error: importError } = await supabase!.from("entries").upsert(rows, { onConflict: "household_id,id" });
        if (importError) { setCloudError("기존 일정을 가져오지 못했어요: " + importError.message); setEntries(cloudEntries); return; }
        setEntries(localEntriesRef.current);
      } else {
        setEntries(cloudEntries);
      }
    };
    void load();
    const channel = supabase.channel("calendar-entries-" + household.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "entries", filter: "household_id=eq." + household.id }, () => { void load(); })
      .subscribe();
    return () => { cancelled = true; void supabase!.removeChannel(channel); };
  }, [session, household]);

  const cloudSave = async (entry: Entry) => {
    if (!supabase || !session || !household) return;
    const { error } = await supabase.from("entries").upsert(cloudRow(entry, household.id, session.user.id), { onConflict: "household_id,id" });
    if (error) { setCloudError("저장에 실패했어요: " + error.message); }
    else setCloudError("");
  };
  const handleAuth = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!supabase) return;
    const name = authName.trim();
    if (name.length < 2 || name.length > 40) { setAuthError("이름은 2~40자로 입력해 주세요."); return; }
    if (authPassword.length < 8) { setAuthError("비밀번호는 8자 이상 입력해 주세요."); return; }
    setAuthBusy(true); setAuthError("");
    try {
      const email = await internalEmail(name);
      if (authMode === "create") {
        const { data, error } = await supabase.auth.signUp({ email, password: authPassword });
        if (error) throw error;
        if (!data.session) throw new Error("Supabase에서 이메일 확인 기능을 꺼야 가입이 바로 완료됩니다. README 설정을 확인해 주세요.");
        const { error: householdError } = await supabase.rpc("create_household", { p_name: "우리의 캘린더", p_login_name: name });
        if (householdError) {
          await supabase.auth.signOut();
          throw householdError;
        }
        setSession(data.session);
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: authPassword });
        if (error) throw new Error("이름 또는 비밀번호가 올바르지 않아요.");
        setSession(data.session);
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "로그인 중 문제가 발생했어요.");
    } finally { setAuthBusy(false); }
  };
  const signOut = async () => { if (supabase) await supabase.auth.signOut(); setSession(null); setHousehold(null); };
  const monthLabel = month.getFullYear() + "년 " + (month.getMonth() + 1) + "월";
  const calendarDays = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first); start.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);
  const visible = (e: Entry) => (filter === "전체" || e.assignee === filter) && (!query || e.title.toLowerCase().includes(query.toLowerCase()));
  const dayEntries = entries.filter(e => e.date === selectedDate && visible(e)).sort((a,b) => (a.time || "").localeCompare(b.time || ""));
  const monthEntries = entries.filter(e => e.date.startsWith(month.getFullYear() + "-" + pad(month.getMonth()+1)));
  const taskCount = monthEntries.filter(e => e.kind === "할 일").length;
  const doneCount = monthEntries.filter(e => e.kind === "할 일" && e.done).length;
  const openNew = (date = selectedDate) => { setEditing(null); setForm({ title: "", date, time: "", kind: "일정", assignee: "함께", category: "이사", note: "" }); setModal(true); };
  const openEdit = (e: Entry) => { setEditing(e); setForm({ title: e.title, date: e.date, time: e.time || "", kind: e.kind, assignee: e.assignee, category: e.category, note: e.note || "" }); setModal(true); };
  const save = (ev: FormEvent) => {
    ev.preventDefault(); if (!form.title.trim()) return;
    const next: Entry = { ...form, title: form.title.trim(), id: editing?.id || (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())), done: editing?.done || false };
    setEntries(prev => editing ? prev.map(e => e.id === editing.id ? next : e) : [...prev, next]);
    setSelectedDate(form.date); const d = new Date(form.date + "T12:00:00"); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setModal(false);
  };
  const remove = async (id: string) => {
    if (!window.confirm("이 항목을 삭제할까요?")) return;
    setEntries(prev => prev.filter(e => e.id !== id));
    if (supabase && household) {
      const { error } = await supabase.from("entries").delete().eq("household_id", household.id).eq("id", id);
      if (error) setCloudError("삭제에 실패했어요: " + error.message);
    }
  };
  const toggleDone = async (entry: Entry) => {
    const updated = { ...entry, done: !entry.done };
    setEntries(prev => prev.map(e => e.id === entry.id ? updated : e));
    await cloudSave(updated);
  };
  const exportJson = () => { const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "our-calendar-backup.json"; a.click(); URL.revokeObjectURL(url); };
  const importJson = (file?: File) => { if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(String(reader.result)); if (!Array.isArray(data) || !data.every((e: Entry) => e.id && e.title && e.date)) throw new Error(); if (window.confirm("현재 항목을 가져온 백업으로 교체할까요?")) {
          void (async () => {
            if (supabase && household) {
              const { error: delError } = await supabase.from("entries").delete().eq("household_id", household.id);
              if (delError) { setCloudError("기존 일정을 비우지 못했어요: " + delError.message); return; }
              const rows = (data as Entry[]).map(e => cloudRow(e, household.id, session!.user.id));
              if (rows.length) {
                const { error: addError } = await supabase.from("entries").insert(rows);
                if (addError) { setCloudError("백업을 클라우드에 가져오지 못했어요: " + addError.message); return; }
              }
            }
            setEntries(data);
          })();
        } } catch { window.alert("올바른 캘린더 JSON 파일이 아닙니다."); } }; reader.readAsText(file); };
  if (!isCloudConfigured) return <div className="auth-screen"><section className="auth-card"><div className="brand auth-brand"><span className="brand-mark"><span></span><span></span><span></span><span></span></span><span>우리의 캘린더<small>OUR LITTLE PLANS</small></span></div><h1>클라우드 설정이 필요해요</h1><p>Supabase 프로젝트를 만든 뒤 Vercel 환경 변수에 Project URL과 publishable/anon key를 추가해 주세요.</p><p className="auth-help">설정 방법은 저장소의 README.md에서 확인할 수 있어요.</p></section></div>;
  if (!authReady) return <div className="auth-screen"><section className="auth-card"><p>클라우드 연결을 확인하고 있어요…</p></section></div>;
  if (!session || !household) return <div className="auth-screen"><form className="auth-card" onSubmit={handleAuth}>
    <div className="brand auth-brand"><span className="brand-mark"><span></span><span></span><span></span><span></span></span><span>우리의 캘린더<small>OUR LITTLE PLANS</small></span></div>
    <div className="eyebrow">YOUR SHARED SPACE</div><h1>{authMode === "create" ? "우리의 캘린더 만들기" : "캘린더에 로그인하기"}</h1>
    <p>두 기기에서 같은 이름과 비밀번호를 사용하면 같은 일정을 볼 수 있어요.</p>
    {cloudError && <div className="auth-error">{cloudError}</div>}
    {authError && <div className="auth-error">{authError}</div>}
    <label className="field-label">캘린더 이름<input required minLength={2} maxLength={40} autoComplete="username" value={authName} onChange={e=>setAuthName(e.target.value)} placeholder="예: 우리 둘의 캘린더"/></label>
    <label className="field-label">비밀번호<input required minLength={8} type="password" autoComplete={authMode === "create" ? "new-password" : "current-password"} value={authPassword} onChange={e=>setAuthPassword(e.target.value)} placeholder="8자 이상"/></label>
    <button type="submit" className="save-button auth-submit" disabled={authBusy}>{authBusy ? "처리 중…" : authMode === "create" ? "캘린더 만들기" : "로그인"}</button>
    <button type="button" className="auth-switch" onClick={()=>{setAuthMode(authMode==="create"?"login":"create");setAuthError("");}}>{authMode === "create" ? "이미 계정이 있나요? 로그인" : "처음 이용하시나요? 새 캘린더 만들기"}</button>
    <p className="auth-help">이름과 비밀번호는 두 기기에서 동일하게 입력해 주세요. 비밀번호를 잊으면 직접 복구하기 어려우니 안전하게 보관해 주세요.</p>
  </form></div>;
  if (session && !household) return <div className="auth-screen"><section className="auth-card"><h1>캘린더를 불러오는 중이에요</h1>{cloudError && <p className="auth-error">{cloudError}</p>}<button className="auth-switch" onClick={signOut}>로그아웃</button></section></div>;
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark"><span></span><span></span><span></span><span></span></span><span>우리의 캘린더<small>OUR LITTLE PLANS</small></span></a>
      <div className="top-actions"><button className="text-button" onClick={signOut}>로그아웃</button><button className="text-button" onClick={exportJson}>↧ <span>백업</span></button><button className="text-button" onClick={() => importRef.current?.click()}>↥ <span>가져오기</span></button><input ref={importRef} type="file" accept="application/json,.json" hidden onChange={e => { importJson(e.target.files?.[0]); e.currentTarget.value = ""; }}/><button className="add-button" onClick={() => openNew()}>＋ <span>새 항목</span></button></div>
    </header>
    <main>
      <section className="welcome-row"><div><div className="eyebrow">TOGETHER, DAY BY DAY</div><h1>우리의 하루를<br className="mobile-break"/> 함께 계획해요<span className="period">.</span></h1><p>작은 계획도 함께라면 더 든든하니까.</p></div><div className="welcome-art" aria-hidden="true"><div className="sun"></div><div className="art-house"><div className="roof"></div><div className="house-body"><div className="window"></div><div className="door"></div></div></div><div className="plant"><i></i><i></i><i></i><b></b></div></div></section>
      <section className="stats-row">
        <div className="stat-card"><div className="stat-icon lavender">▦</div><div><span>이번 달 일정</span><strong>{monthEntries.filter(e => e.kind === "일정").length}<small>개</small></strong></div></div>
        <div className="stat-card"><div className="stat-icon peach">✓</div><div><span>할 일 진행</span><strong>{doneCount}<small> / {taskCount}개</small></strong></div></div>
        <div className="stat-card"><div className="stat-icon mint">♡</div><div><span>함께하는 계획</span><strong>{monthEntries.filter(e => e.assignee === "함께").length}<small>개</small></strong></div></div>
      </section>
      <section className="workspace">
        <div className="calendar-panel">
          <div className="panel-heading"><div><div className="eyebrow">YOUR MONTH</div><h2>{monthLabel}</h2></div><div className="month-controls"><button aria-label="이전 달" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth()-1, 1))}>‹</button><button className="today-button" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(dateKey(today)); }}>오늘</button><button aria-label="다음 달" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth()+1, 1))}>›</button></div></div>
          <div className="weekday-row">{["일","월","화","수","목","금","토"].map((d,i)=><div key={d} className={i===0?"sunday":i===6?"saturday":""}>{d}</div>)}</div>
          <div className="calendar-grid">{calendarDays.map((day,i) => { const key=dateKey(day); const items=entries.filter(e=>e.date===key && visible(e)); const sameMonth=day.getMonth()===month.getMonth(); return <button key={key} className={"day-cell "+(!sameMonth?"outside ":"")+(key===selectedDate?"selected ":"")+(key===dateKey(today)?"is-today":"")} onClick={()=>setSelectedDate(key)}><span className={"day-number "+(i%7===0?"sunday":i%7===6?"saturday":"")}>{day.getDate()}</span><span className="day-dots">{items.slice(0,3).map(e=><i key={e.id} className={"dot "+categoryClass(e.category)}></i>)}{items.length>3&&<b>+{items.length-3}</b>}</span></button>; })}</div>
          <div className="calendar-legend"><span><i className="dot moving"></i>이사</span><span><i className="dot home"></i>집</span><span><i className="dot money"></i>금융</span><span><i className="dot work"></i>일</span><span className="legend-note">날짜를 눌러 계획을 확인하세요</span></div>
        </div>
        <aside className="day-panel">
          <div className="day-panel-top"><div><div className="eyebrow">YOUR DAY</div><h2>{new Date(selectedDate+"T12:00:00").toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"long"})}</h2></div><button className="round-add" onClick={()=>openNew()} aria-label="선택한 날짜에 추가">＋</button></div>
          <div className="filter-row">{(["전체","나","배우자","함께"] as const).map(f=><button key={f} className={filter===f?"active":""} onClick={()=>setFilter(f)}>{f}</button>)}</div>
          <label className="search-box"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="일정이나 할 일 검색"/></label>
          <div className="entry-list">{dayEntries.length===0?<div className="empty-state"><div className="empty-illustration">☁</div><strong>아직 계획이 없어요</strong><p>작은 계획을 추가해 볼까요?</p><button onClick={()=>openNew()}>＋ 계획 추가하기</button></div>:dayEntries.map(entry=><article className={"entry-card "+(entry.done?"completed":"")} key={entry.id}><div className={"entry-stripe "+categoryClass(entry.category)}></div><div className="entry-content"><div className="entry-meta"><span className={"kind-pill "+(entry.kind==="할 일"?"task":"event")}>{entry.kind}</span><span className="category-label">{entry.category}</span>{entry.time&&<span className="time-label">{entry.time}</span>}</div><button className="entry-title" onClick={()=>openEdit(entry)}>{entry.title}</button><div className="entry-footer"><span className={"assignee "+(entry.assignee==="함께"?"together":entry.assignee==="배우자"?"partner":"me")}><i></i>{entry.assignee}</span><div className="entry-actions">{entry.kind==="할 일"&&<button className="done-toggle" onClick={()=>void toggleDone(entry)}>{entry.done?"완료 취소":"완료 체크"}</button>}<button className="icon-action" onClick={()=>openEdit(entry)} aria-label="수정">✎</button><button className="icon-action" onClick={()=>remove(entry.id)} aria-label="삭제">×</button></div></div>{entry.note&&<p className="entry-note">{entry.note}</p>}</div></article>)}</div>
          <button className="wide-add" onClick={()=>openNew()}>＋ <span>이 날짜에 계획 추가</span></button>
        </aside>
      </section>
      <footer className="footer"><span>둘이 함께 채워가는 작은 기록</span><span>저장 위치: 클라우드 <i>·</i> {household.name} <i>·</i> 기기 간 동기화 사용 중</span></footer>
    </main>
    {modal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(false);}}><form className="entry-modal" onSubmit={save}><div className="modal-heading"><div><div className="eyebrow">{editing?"EDIT YOUR PLAN":"MAKE A PLAN"}</div><h2>{editing?"계획 수정하기":"새 계획 추가하기"}</h2></div><button type="button" className="close-modal" onClick={()=>setModal(false)} aria-label="닫기">×</button></div>
      <label className="field-label">무엇을 할까요?<input autoFocus required maxLength={80} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="예: 이사 체크리스트 확인"/></label>
      <div className="field-grid"><label className="field-label">날짜<input type="date" required value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><label className="field-label">시간 <span className="optional">(선택)</span><input value={form.time} onChange={e=>setForm({...form,time:e.target.value})} placeholder="예: 10:00"/></label></div>
      <div className="field-label">항목 유형<div className="choice-row">{(["일정","할 일"] as Kind[]).map(k=><button type="button" key={k} className={form.kind===k?"chosen":""} onClick={()=>setForm({...form,kind:k})}>{k==="일정"?"▦":"✓"} {k}</button>)}</div></div>
      <div className="field-grid"><label className="field-label">담당자<select value={form.assignee} onChange={e=>setForm({...form,assignee:e.target.value as Assignee})}><option>함께</option><option>나</option><option>배우자</option></select></label><label className="field-label">카테고리<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{categories.map(c=><option key={c}>{c}</option>)}</select></label></div>
      <label className="field-label">메모 <span className="optional">(선택)</span><textarea rows={3} maxLength={500} value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="함께 기억할 내용을 적어두세요."/></label>
      <div className="modal-actions"><button type="button" className="cancel-button" onClick={()=>setModal(false)}>취소</button><button type="submit" className="save-button">{editing?"변경사항 저장":"계획 저장하기"}</button></div>
    </form></div>}
  </div>;
}
