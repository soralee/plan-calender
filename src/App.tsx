import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, isCloudConfigured } from "./lib/supabase";

type Assignee = "나" | "배우자" | "함께";
type Kind = "일정" | "할 일";
type Entry = { id: string; title: string; date: string; time?: string; kind: Kind; assignee: Assignee; category: string; done: boolean; note?: string };
const STORAGE_KEY = "our-calendar-entries-v1";
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

const readLocalEntries = (): Entry[] => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) as Entry[] : seed;
  } catch { return seed; }
};

const cloudRow = (entry: Entry, householdId: string, userId: string) => ({
  household_id: householdId,
  id: entry.id,
  title: entry.title,
  date: entry.date,
  time: entry.time || null,
  kind: entry.kind,
  assignee: entry.assignee,
  category: entry.category,
  done: entry.done,
  note: entry.note || null,
  created_by: userId
});
type Household = { id: string; name: string; login_name: string; member_one_name?: string; member_two_name?: string };
const defaultNamePairs = [["라임", "모카"], ["구름", "별이"], ["보리", "두부"], ["하루", "나루"], ["토리", "루미"], ["단추", "콩이"], ["초코", "바닐라"], ["유자", "호두"]];
const randomNamePair = () => defaultNamePairs[Math.floor(Math.random() * defaultNamePairs.length)];

export default function App() {
  const [entries, setEntries] = useState<Entry[]>(readLocalEntries);
  const localEntriesRef = useRef<Entry[]>(entries);
  const [session, setSession] = useState<Session | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [householdReady, setHouseholdReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authName, setAuthName] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "create">("login");
  const [deletePassword, setDeletePassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [cloudError, setCloudError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memberNamesOpen, setMemberNamesOpen] = useState(false);
  const [memberNamesError, setMemberNamesError] = useState("");
  const [memberNamesMessage, setMemberNamesMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkImportText, setBulkImportText] = useState("");
  const [bulkImportDate, setBulkImportDate] = useState(dateKey(today));
  const [bulkImportAssignee, setBulkImportAssignee] = useState<Assignee>("나");
  const [bulkImportCategory] = useState("개인");
  const [bulkImportError, setBulkImportError] = useState("");
  const [bulkImportBusy, setBulkImportBusy] = useState(false);
  const [settingsName, setSettingsName] = useState("");
  const [initialNamePair] = useState(() => randomNamePair());
  const [myDisplayName, setMyDisplayName] = useState(initialNamePair[0]);
  const [partnerDisplayName, setPartnerDisplayName] = useState(initialNamePair[1]);
  const [settingsPassword, setSettingsPassword] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(dateKey(today));
  const [filter, setFilter] = useState<"전체" | Assignee>("전체");
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [form, setForm] = useState({ title: "", date: dateKey(today), time: "", kind: "일정" as Kind, assignee: "함께" as Assignee, category: "이사", note: "" });
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* private browsing or storage disabled */ }
  }, [entries]);

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) { setHousehold(null); setCloudError(""); setHouseholdReady(true); }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) { setHousehold(null); setHouseholdReady(true); return; }
    let cancelled = false;
    setHouseholdReady(false);
    (async () => {
      setCloudError("");
      const { data: membership, error: membershipError } = await supabase!
        .from("household_members").select("household_id").eq("user_id", session.user.id).limit(1).maybeSingle();
      if (cancelled) return;
      if (membershipError) { setCloudError("클라우드 설정을 확인해 주세요. Supabase SQL 설정이 완료되었는지 확인해 주세요."); setHouseholdReady(true); return; }
      if (!membership) { setHousehold(null); setHouseholdReady(true); return; }
      const { data: home, error: homeError } = await supabase!
        .from("households").select("id,name,login_name,member_one_name,member_two_name").eq("id", membership.household_id).maybeSingle();
      if (cancelled) return;
      if (homeError || !home) { setCloudError("공유 캘린더 정보를 불러오지 못했어요."); setHouseholdReady(true); return; }
      setHousehold(home as Household);
      setHouseholdReady(true);
      setMyDisplayName(home.member_one_name || initialNamePair[0]);
      setPartnerDisplayName(home.member_two_name || initialNamePair[1]);
    })();
    return () => { cancelled = true; };
  }, [session?.user.id]);

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
    if (name.length < 2 || name.length > 40) { setAuthError('캘린더 이름은 2~40자로 입력해 주세요.'); return; }
    if (authPassword.length < 8) { setAuthError('비밀번호는 8자 이상 입력해 주세요.'); return; }
    setAuthBusy(true); setAuthError('');
    try {
      const { data: current, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!current.session) {
        const { error: anonError } = await supabase.auth.signInAnonymously();
        if (anonError) throw new Error('익명 로그인 실패: ' + anonError.message);
      }
      const { data: loginData, error: loginError } = await supabase.rpc('login_household', { p_login_name: name, p_password: authPassword });
      if (loginError) throw new Error('캘린더 로그인 실패: ' + loginError.message);
      const home = Array.isArray(loginData) ? loginData[0] : loginData;
      if (!home || !home.household_id) throw new Error('캘린더 정보를 찾을 수 없어요.');
      const { data: sessionData, error: refreshedSessionError } = await supabase.auth.getSession();
      if (refreshedSessionError) throw refreshedSessionError;
      setSession(sessionData.session);
      setHousehold({ id: home.household_id, name: home.household_name, login_name: home.login_name });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '로그인 중 문제가 발생했어요.');
    } finally { setAuthBusy(false); }
  };
  const handleCreateHousehold = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!supabase) return;
    const name = authName.trim();
    if (name.length < 2 || name.length > 40) { setAuthError("캘린더 이름은 2~40자로 입력해 주세요."); return; }
    if (authPassword.length < 8) { setAuthError("비밀번호는 8자 이상 입력해 주세요."); return; }

    setAuthError("");
    // Check duplicate names before changing the screen/session into the loading state.
    setAuthBusy(true);
    try {
      const { data: current, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      // If an anonymous session is already present, the RPC can validate the name
      // while the current form remains visible. The database function returns a clear
      // duplicate-name message and only creates a session membership on success.
      if (!current.session) {
        const { error: anonError } = await supabase.auth.signInAnonymously();
        if (anonError) throw new Error("익명 로그인 실패: " + anonError.message);
      }
      const { data, error } = await supabase.rpc("create_household_with_password", {
        p_name: name, p_login_name: name, p_password: authPassword
      });
      if (error) {
        const message = error.message || "";
        if (message.toLowerCase().includes("already") || message.includes("이미 사용 중")) {
          setAuthError("이미 사용 중인 캘린더 이름이에요. 다른 이름을 입력해 주세요.");
        } else {
          setAuthError("캘린더를 등록하지 못했어요. " + message);
        }
        return;
      }
      const home = Array.isArray(data) ? data[0] : data;
      if (!home?.household_id) {
        setAuthError("새 캘린더 정보를 확인할 수 없어요.");
        return;
      }
      const { data: sessionData, error: refreshedSessionError } = await supabase.auth.getSession();
      if (refreshedSessionError) throw refreshedSessionError;
      setHousehold({ id: home.household_id, name: home.household_name, login_name: home.login_name || name });
      setSession(sessionData.session);
      setAuthPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "캘린더를 만들지 못했어요.");
    } finally { setAuthBusy(false); }
  };
  const deleteHousehold = async () => {
    if (!supabase || !session || !household) return;
    if (deletePassword.length < 8) { setSettingsError("삭제를 확인하려면 현재 비밀번호를 8자 이상 입력해 주세요."); return; }
    if (!window.confirm("정말 이 캘린더를 삭제할까요? 캘린더와 모든 일정이 영구 삭제되며 복구할 수 없습니다.")) return;
    setAuthBusy(true); setSettingsError(""); setSettingsMessage("");
    try {
      const { error } = await supabase.rpc("delete_household_with_password", { p_password: deletePassword });
      if (error) throw new Error("캘린더 삭제 실패: " + error.message);
      setDeletePassword("");
      setSettingsOpen(false);
      setHousehold(null);
      setEntries(readLocalEntries());
      await supabase.auth.signOut();
      setSession(null);
      setAuthName("");
      setAuthPassword("");
      setAuthMode("login");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "캘린더를 삭제하지 못했어요.");
    } finally { setAuthBusy(false); }
  };
  const signOut = async () => { if (supabase) await supabase.auth.signOut(); setSession(null); setHousehold(null); };
  const openSettings = () => {
    setSettingsName(household?.login_name || "");
    setMyDisplayName(household?.member_one_name || initialNamePair[0]);
    setPartnerDisplayName(household?.member_two_name || initialNamePair[1]);
    setSettingsPassword("");
    setSettingsError("");
    setSettingsMessage("");
    setSettingsOpen(true);
  };
  const openMemberNames = () => {
    setMyDisplayName(household?.member_one_name || "나");
    setPartnerDisplayName(household?.member_two_name || "배우자");
    setMemberNamesError("");
    setMemberNamesMessage("");
    setMemberNamesOpen(true);
  };
  const saveMemberNames = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!supabase || !session || !household) return;
    const nextMine = myDisplayName.trim();
    const nextPartner = partnerDisplayName.trim();
    if (!nextMine || nextMine.length > 20 || !nextPartner || nextPartner.length > 20) { setMemberNamesError("두 사람의 이름을 1~20자로 입력해 주세요."); return; }
    if (nextMine.toLocaleLowerCase("ko-KR") === nextPartner.toLocaleLowerCase("ko-KR")) { setMemberNamesError("두 사람의 이름은 서로 다르게 입력해 주세요."); return; }
    setAuthBusy(true); setMemberNamesError(""); setMemberNamesMessage("");
    try {
      const { error } = await supabase.rpc("update_household_member_names", { p_member_one_name: nextMine, p_member_two_name: nextPartner });
      if (error) throw error;
      setHousehold({ ...household, member_one_name: nextMine, member_two_name: nextPartner });
      setMemberNamesMessage("담당자 이름을 저장했어요.");
    } catch (error) {
      setMemberNamesError(error instanceof Error ? error.message : "담당자 이름을 저장하지 못했어요.");
    } finally { setAuthBusy(false); }
  };
  const saveSettings = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!supabase || !session || !household) return;
    const nextName = settingsName.trim();
    const nextMine = myDisplayName.trim();
    const nextPartner = partnerDisplayName.trim();
    const nameChanged = nextName.toLocaleLowerCase("ko-KR") !== household.login_name.toLocaleLowerCase("ko-KR");
    const membersChanged = nextMine !== (household.member_one_name || initialNamePair[0]) || nextPartner !== (household.member_two_name || initialNamePair[1]);
    if (nameChanged && (nextName.length < 2 || nextName.length > 40)) { setSettingsError("캘린더 로그인 이름은 2~40자로 입력해 주세요."); return; }
    if (!nextMine || nextMine.length > 20 || !nextPartner || nextPartner.length > 20) { setSettingsError("두 사람의 이름을 1~20자로 입력해 주세요."); return; }
    if (nextMine.toLocaleLowerCase("ko-KR") === nextPartner.toLocaleLowerCase("ko-KR")) { setSettingsError("두 사람의 이름은 서로 다르게 입력해 주세요."); return; }
    if (settingsPassword && settingsPassword.length < 8) { setSettingsError("새 비밀번호는 8자 이상 입력해 주세요."); return; }
    if (!nameChanged && !settingsPassword && !membersChanged) { setSettingsError("변경할 항목이 없어요."); return; }
    setAuthBusy(true); setSettingsError(""); setSettingsMessage("");
    try {
      if (nameChanged) {
        const { error: renameError } = await supabase.rpc("rename_household_login", { p_new_login_name: nextName });
        if (renameError) throw renameError;
      }
      if (membersChanged) {
        const { error: namesError } = await supabase.rpc("update_household_member_names", { p_member_one_name: nextMine, p_member_two_name: nextPartner });
        if (namesError) throw namesError;
      }
      if (settingsPassword) {
        const { error: passwordError } = await supabase.rpc("update_household_password", { p_password: settingsPassword });
        if (passwordError) throw passwordError;
      }
      setHousehold({ ...household, ...(nameChanged ? { name: nextName, login_name: nextName } : {}), member_one_name: nextMine, member_two_name: nextPartner });
      setSettingsPassword("");
      setSettingsMessage("변경사항을 저장했어요. 두 사람의 이름은 공유 캘린더에 반영됩니다.");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "설정을 변경하지 못했어요.");
    } finally { setAuthBusy(false); }
  };
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
  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!form.title.trim()) return;
    const next: Entry = {
      ...form,
      title: form.title.trim(),
      id: editing?.id || (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())),
      done: editing?.done || false
    };
    setEntries(prev => editing ? prev.map(e => e.id === editing.id ? next : e) : [...prev, next]);
    await cloudSave(next);
    setSelectedDate(form.date);
    const d = new Date(form.date + "T12:00:00");
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setModal(false);
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
  const importReminders = async (ev: FormEvent) => {
    ev.preventDefault();
    const lines = bulkImportText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) { setBulkImportError("가져올 할 일을 한 줄 이상 붙여 넣어 주세요."); return; }
    const additions: Entry[] = lines.map((line, index) => {
      // Supported: YYYY-MM-DD | HH:mm | title, YYYY-MM-DD HH:mm | title, or YYYY-MM-DD | title.
      const threePart = line.match(/^(\d{4}-\d{1,2}-\d{1,2})\s*[|｜、,]\s*(\d{1,2}:\d{2})\s*[|｜、,]\s*(.+)$/);
      const dateAndTime = line.match(/^(\d{4}-\d{1,2}-\d{1,2})[ T](\d{1,2}:\d{2})\s*[|｜、,]\s*(.+)$/);
      const dated = line.match(/^(\d{4}-\d{1,2}-\d{1,2})\s*[|｜、,]\s*(.+)$/);
      const rawDate = threePart?.[1] || dateAndTime?.[1] || dated?.[1];
      const rawTime = threePart?.[2] || dateAndTime?.[2] || "";
      const title = (threePart?.[3] || dateAndTime?.[3] || dated?.[2] || line).trim().replace(/^[-•*✓☐☑]\s*/, "");
      const date = rawDate ? (() => { const parts = rawDate.split("-").map(Number); return parts[0] + "-" + pad(parts[1]) + "-" + pad(parts[2]); })() : bulkImportDate;
      const validTime = /^([01]?\d|2[0-3]):[0-5]\d$/.test(rawTime) ? rawTime.padStart(5, "0") : undefined;
      return { id: crypto.randomUUID ? crypto.randomUUID() : "reminder-" + Date.now() + "-" + index, title, date, ...(validTime ? { time: validTime } : {}), kind: "할 일" as Kind, assignee: bulkImportAssignee, category: bulkImportCategory, done: false };
    }).filter(entry => entry.title.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(entry.date));
    if (!additions.length) { setBulkImportError("가져올 할 일과 날짜를 확인해 주세요."); return; }
    setBulkImportBusy(true); setBulkImportError(""); setCloudError("");
    try {
      if (supabase && session && household) {
        const rows = additions.map(entry => cloudRow(entry, household.id, session.user.id));
        const { error } = await supabase.from("entries").upsert(rows, { onConflict: "household_id,id" });
        if (error) throw error;
      }
      setEntries(current => [...current, ...additions]);
      setBulkImportText("");
      setBulkImportOpen(false);
      window.alert(additions.length + "개의 할 일을 기존 일정에 추가했어요.");
    } catch (error) {
      setBulkImportError("할 일을 추가하지 못했어요. " + (error instanceof Error ? error.message : ""));
    } finally { setBulkImportBusy(false); }
  };
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
  if (!authReady || (session && !householdReady)) return <div className="auth-screen"><section className="auth-card loading-card"><div className="brand auth-brand"><span className="brand-mark"><span></span><span></span><span></span><span></span></span><span>우리의 캘린더<small>OUR LITTLE PLANS</small></span></div><div className="loading-indicator" aria-hidden="true"><span></span><span></span><span></span></div><h1 className="loading-title">캘린더를 불러오고 있어요</h1><p className="loading-copy">잠시만 기다려 주세요.</p></section></div>;
  // If a session exists but no household is resolved, keep the auth form available instead of trapping the user on a loading screen.
  if (!session || !household) return <div className="auth-screen"><form className="auth-card" onSubmit={authMode === "login" ? handleAuth : handleCreateHousehold}>
    <div className="brand auth-brand"><span className="brand-mark"><span></span><span></span><span></span><span></span></span><span>우리의 캘린더<small>OUR LITTLE PLANS</small></span></div>
    <div className="eyebrow">YOUR SHARED SPACE</div><h1>{authMode === "login" ? "캘린더에 로그인하기" : "새 캘린더 만들기"}</h1>
    <p>{authMode === "login" ? "두 기기에서 같은 이름과 비밀번호를 사용하면 같은 일정을 볼 수 있어요." : "새 이름과 비밀번호로 별도의 공유 캘린더를 만들어요."}</p>
    {cloudError && <div className="auth-error">{cloudError}</div>}
    {authError && <div className="auth-error">{authError}</div>}
    <label className="field-label">캘린더 이름<input required minLength={2} maxLength={40} autoComplete="username" value={authName} onChange={e=>setAuthName(e.target.value)} placeholder="예: 우리 둘의 캘린더"/></label>
    <label className="field-label">비밀번호<input required minLength={8} type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} value={authPassword} onChange={e=>setAuthPassword(e.target.value)} placeholder="8자 이상"/></label>
    <button type="submit" className="save-button auth-submit" disabled={authBusy}>{authBusy ? "처리 중…" : authMode === "login" ? "로그인" : "캘린더 만들기"}</button>
    <button type="button" className="auth-switch" onClick={() => { setAuthMode(authMode === "login" ? "create" : "login"); setAuthError(""); setAuthPassword(""); }}>{authMode === "login" ? "새 캘린더 등록하기" : "기존 캘린더 로그인하기"}</button>
    <p className="auth-help">{authMode === "login" ? "기존 캘린더 이름과 비밀번호로 로그인하세요." : "캘린더 이름은 다른 캘린더와 중복될 수 없어요. 비밀번호는 8자 이상으로 설정해 주세요."} 비밀번호는 안전하게 보관해 주세요.</p>
  </form></div>;
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand appbar-brand" href="#" aria-label="캘린더 홈">
        <span className="brand-mark"><span></span><span></span><span></span><span></span></span>
        <span className="calendar-title" title={household?.name || "우리의 캘린더"}>{(household?.name || "우리의 캘린더").replace(/[.。]+\s*$/, "")}</span>
      </a>
      <div className="top-actions">
        <button className="add-button" onClick={() => openNew()}><span className="add-symbol">＋</span><span className="add-label">새 항목</span></button>
        <div className="menu-wrap">
          <button className="menu-button" aria-label="더보기 메뉴" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}><span></span><span></span><span></span></button>
          {menuOpen && <><button className="menu-dismiss" aria-label="메뉴 닫기" onClick={() => setMenuOpen(false)}></button><div className="overflow-menu" role="menu">
            <button role="menuitem" onClick={() => { setMenuOpen(false); openMemberNames(); }}>담당자 이름 설정</button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); openSettings(); }}>계정 설정</button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); exportJson(); }}>백업 다운로드</button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); importRef.current?.click(); }}>백업 가져오기</button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); setBulkImportError(""); setBulkImportOpen(true); }}>미리 알림 일괄 추가</button>
            <div className="menu-divider"></div>
            <button role="menuitem" className="logout-menu-item" onClick={() => { setMenuOpen(false); void signOut(); }}>로그아웃</button>
          </div></>}
        </div>
        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={e => { importJson(e.target.files?.[0]); e.currentTarget.value = ""; }}/>
      </div>
    </header>
    <main>
      <section className="welcome-row"><div><div className="eyebrow">TOGETHER, DAY BY DAY</div><h1>{household?.name || "우리의 캘린더"}<span className="period">.</span></h1><p>작은 계획도 함께라면 더 든든하니까.</p></div><div className="welcome-art" aria-hidden="true"><div className="sun"></div><div className="art-house"><div className="roof"></div><div className="house-body"><div className="window"></div><div className="door"></div></div></div><div className="plant"><i></i><i></i><i></i><b></b></div></div></section>
      <section className="stats-row">
        <div className="stat-card"><div className="stat-icon lavender">▦</div><div><span>이번 달 일정</span><strong>{monthEntries.filter(e => e.kind === "일정").length}<small>개</small></strong></div></div>
        <div className="stat-card"><div className="stat-icon peach">✓</div><div><span>할 일 진행</span><strong>{doneCount}<small> / {taskCount}개</small></strong></div></div>
        <div className="stat-card"><div className="stat-icon mint">♡</div><div><span>함께하는 계획</span><strong>{monthEntries.filter(e => e.assignee === "함께").length}<small>개</small></strong></div></div>
      </section>
      <section className="workspace">
        <div className="calendar-panel">
          <div className="panel-heading"><div><div className="eyebrow">YOUR MONTH</div><h2>{monthLabel}</h2></div><div className="month-controls"><button aria-label="이전 달" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth()-1, 1))}>‹</button><button className="today-button" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(dateKey(today)); }}>오늘</button><button aria-label="다음 달" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth()+1, 1))}>›</button></div></div>
          <div className="weekday-row">{["일","월","화","수","목","금","토"].map((d,i)=><div key={d} className={i===0?"sunday":i===6?"saturday":""}>{d}</div>)}</div>
          <div className="calendar-grid">{calendarDays.map((day,i) => { const key=dateKey(day); const items=entries.filter(e=>e.date===key); const sameMonth=day.getMonth()===month.getMonth(); return <button key={key} className={"day-cell "+(!sameMonth?"outside ":"")+(key===selectedDate?"selected ":"")+(key===dateKey(today)?"is-today":"")} onClick={()=>setSelectedDate(key)}><span className={"day-number "+(i%7===0?"sunday":i%7===6?"saturday":"")}>{day.getDate()}</span><span className="day-dots">{items.slice(0,3).map(e=><i key={e.id} title={e.assignee} className={"dot "+(e.assignee==="함께"?"assignee-together":e.assignee==="배우자"?"assignee-partner":"assignee-me")}></i>)}{items.length>3&&<b>+{items.length-3}</b>}</span></button>; })}</div>
          <div className="calendar-legend assignee-legend"><span><i className="dot assignee-me"></i>{myDisplayName}</span><span><i className="dot assignee-partner"></i>{partnerDisplayName}</span><span><i className="dot assignee-together"></i>함께</span><span className="legend-note">점 색상으로 담당자를 확인하세요</span></div>
        </div>
        <aside className="day-panel">
          <div className="day-panel-top"><div><div className="eyebrow">YOUR DAY</div><h2>{new Date(selectedDate+"T12:00:00").toLocaleDateString("ko-KR",{month:"long",day:"numeric",weekday:"long"})}</h2></div><button className="round-add" onClick={()=>openNew()} aria-label="선택한 날짜에 추가">＋</button></div>
          <div className="filter-row">{(["전체","나","배우자","함께"] as const).map(f=><button key={f} className={filter===f?"active":""} onClick={()=>setFilter(f)}>{f==="나"?myDisplayName:f==="배우자"?partnerDisplayName:f}</button>)}</div>
          <label className="search-box"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="일정이나 할 일 검색"/></label>
          <div className="entry-list">{dayEntries.length===0?<div className="empty-state"><div className="empty-illustration">☁</div><strong>아직 계획이 없어요</strong><p>작은 계획을 추가해 볼까요?</p><button onClick={()=>openNew()}>＋ 계획 추가하기</button></div>:dayEntries.map(entry=><article className={"entry-card "+(entry.done?"completed":"")} key={entry.id}><div className="entry-content"><div className="entry-meta"><span className={"kind-pill "+(entry.kind==="할 일"?"task":"event")}>{entry.kind}</span>{entry.time&&<span className="time-label">{entry.time}</span>}</div><button className="entry-title" onClick={()=>openEdit(entry)}>{entry.title}</button><div className="entry-footer"><span className={"assignee "+(entry.assignee==="함께"?"together":entry.assignee==="배우자"?"partner":"me")}><i></i>{entry.assignee==="나"?myDisplayName:entry.assignee==="배우자"?partnerDisplayName:entry.assignee}</span><div className="entry-actions">{entry.kind==="할 일"&&<button className="done-toggle" onClick={()=>void toggleDone(entry)}>{entry.done?"완료 취소":"완료 체크"}</button>}<button className="icon-action" onClick={()=>openEdit(entry)} aria-label="수정">✎</button><button className="icon-action" onClick={()=>remove(entry.id)} aria-label="삭제">×</button></div></div>{entry.note&&<p className="entry-note">{entry.note}</p>}</div></article>)}</div>
          <button className="wide-add" onClick={()=>openNew()}>＋ <span>이 날짜에 계획 추가</span></button>
        </aside>
      </section>
      <footer className="footer"><span>둘이 함께 채워가는 작은 기록</span><span>저장 위치: 클라우드 <i>·</i> {household?.name} <i>·</i> 기기 간 동기화 사용 중</span></footer>
    </main>
    {bulkImportOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!bulkImportBusy)setBulkImportOpen(false);}}><form className="entry-modal" onSubmit={importReminders}><div className="modal-heading"><div><div className="eyebrow">BULK ADD TASKS</div><h2>미리 알림 일괄 추가</h2></div><button type="button" className="close-modal" onClick={()=>setBulkImportOpen(false)} aria-label="닫기" disabled={bulkImportBusy}>×</button></div>
      <p className="settings-description">아이폰 ‘미리 알림’에서 반복 항목은 제외하고, 할 일 제목을 한 줄에 하나씩 붙여 넣으세요. 기존 일정은 유지되고 새 할 일만 추가돼요.</p>
      <p className="settings-description">날짜와 시간을 지정하려면 <strong>2026-10-29 | 08:00 | 입주 청소</strong> 또는 <strong>2026-10-29 08:00 | 입주 청소</strong>처럼 입력하세요. 날짜만 지정하려면 <strong>2026-10-25 | 이사 박스 정리</strong>처럼 입력하고, 날짜가 없는 줄은 아래 기본 날짜로 추가됩니다.</p>
      {bulkImportError&&<div className="auth-error">{bulkImportError}</div>}
      <label className="field-label">할 일 목록<textarea required rows={8} value={bulkImportText} onChange={e=>setBulkImportText(e.target.value)} placeholder={"예:\n2026-10-25 | 이사 박스 정리\n관리사무소에 연락하기\n전입신고 준비"} /></label>
      <label className="field-label">날짜가 없는 항목의 기본 날짜<input type="date" required value={bulkImportDate} onChange={e=>setBulkImportDate(e.target.value)} /></label>
      <label className="field-label">담당자<select value={bulkImportAssignee} onChange={e=>setBulkImportAssignee(e.target.value as Assignee)}><option value="나">{myDisplayName}</option><option value="배우자">{partnerDisplayName}</option><option value="함께">함께</option></select></label>
      <div className="modal-actions"><button type="button" className="cancel-button" disabled={bulkImportBusy} onClick={()=>setBulkImportOpen(false)}>취소</button><button type="submit" className="save-button" disabled={bulkImportBusy}>{bulkImportBusy?"추가 중…":"할 일 추가하기"}</button></div>
    </form></div>}
    {memberNamesOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setMemberNamesOpen(false);}}><form className="entry-modal" onSubmit={saveMemberNames}><div className="modal-heading"><div><div className="eyebrow">SHARED CALENDAR</div><h2>담당자 이름 설정</h2></div><button type="button" className="close-modal" onClick={()=>setMemberNamesOpen(false)} aria-label="닫기">×</button></div>
      
      {memberNamesError&&<div className="auth-error">{memberNamesError}</div>}
      {memberNamesMessage&&<div className="settings-success">{memberNamesMessage}</div>}
      <div className="field-grid"><label className="field-label">첫 번째 사람 이름<input required maxLength={20} value={myDisplayName} onChange={e=>setMyDisplayName(e.target.value)} placeholder="예: 소라"/></label><label className="field-label">두 번째 사람 이름<input required maxLength={20} value={partnerDisplayName} onChange={e=>setPartnerDisplayName(e.target.value)} placeholder="예: 민수"/></label></div>
      
      <div className="modal-actions"><button type="button" className="cancel-button" onClick={()=>setMemberNamesOpen(false)}>닫기</button><button type="submit" className="save-button" disabled={authBusy}>{authBusy?"저장 중…":"이름 저장"}</button></div>
    </form></div>}
    {settingsOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSettingsOpen(false);}}><form className="entry-modal" onSubmit={saveSettings}><div className="modal-heading"><div><div className="eyebrow">ACCOUNT SETTINGS</div><h2>계정 설정</h2></div><button type="button" className="close-modal" onClick={()=>setSettingsOpen(false)} aria-label="닫기">×</button></div>
      <p className="settings-description">이름을 바꾸면 캘린더 제목과 로그인 이름이 함께 변경돼요. 비밀번호는 변경할 때만 입력하세요.</p>
      {settingsError&&<div className="auth-error">{settingsError}</div>}
      {settingsMessage&&<div className="settings-success">{settingsMessage}</div>}
      <label className="field-label">캘린더 로그인 이름<input required minLength={2} maxLength={40} autoComplete="username" value={settingsName} onChange={e=>setSettingsName(e.target.value)} placeholder="캘린더 로그인 이름"/></label><div className="field-grid"><label className="field-label">첫 번째 사람 이름<input required maxLength={20} value={myDisplayName} onChange={e=>setMyDisplayName(e.target.value)} placeholder="예: 소라"/></label><label className="field-label">두 번째 사람 이름<input required maxLength={20} value={partnerDisplayName} onChange={e=>setPartnerDisplayName(e.target.value)} placeholder="예: 민수"/></label></div><p className="settings-description">담당자 선택과 필터에 표시되는 이름이에요. 기존의 ‘나’는 첫 번째 사람, ‘배우자’는 두 번째 사람에 해당해요.</p>
      <label className="field-label">새 비밀번호 <span className="optional">(선택, 8자 이상)</span><input type="password" autoComplete="new-password" minLength={8} value={settingsPassword} onChange={e=>setSettingsPassword(e.target.value)} placeholder="변경하지 않으려면 비워 두세요"/></label>
      <div className="modal-actions"><button type="button" className="cancel-button" onClick={()=>setSettingsOpen(false)}>닫기</button><button type="submit" className="save-button" disabled={authBusy}>{authBusy?"저장 중…":"변경사항 저장"}</button></div>
      <div className="settings-danger"><h3>캘린더 삭제</h3><p>캘린더와 그 안의 모든 일정이 영구 삭제돼요. 삭제하려면 현재 비밀번호를 입력하세요.</p><label className="field-label">현재 비밀번호<input type="password" autoComplete="current-password" value={deletePassword} onChange={e=>setDeletePassword(e.target.value)} placeholder="삭제 확인용 비밀번호"/></label><button type="button" className="delete-calendar-button" disabled={authBusy} onClick={() => void deleteHousehold()}>{authBusy ? "처리 중…" : "캘린더 영구 삭제"}</button></div>
    </form></div>}
    {modal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setModal(false);}}><form className="entry-modal" onSubmit={save}><div className="modal-heading"><div><div className="eyebrow">{editing?"EDIT YOUR PLAN":"MAKE A PLAN"}</div><h2>{editing?"계획 수정하기":"새 계획 추가하기"}</h2></div><button type="button" className="close-modal" onClick={()=>setModal(false)} aria-label="닫기">×</button></div>
      <label className="field-label">무엇을 할까요?<input autoFocus required maxLength={80} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="예: 이사 체크리스트 확인"/></label>
      <div className="field-grid"><label className="field-label">날짜<input type="date" required value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label><label className="field-label">시간 <span className="optional">(선택)</span><input value={form.time} onChange={e=>setForm({...form,time:e.target.value})} placeholder="예: 10:00"/></label></div>
      <div className="field-label">항목 유형<div className="choice-row">{(["일정","할 일"] as Kind[]).map(k=><button type="button" key={k} className={form.kind===k?"chosen":""} onClick={()=>setForm({...form,kind:k})}>{k==="일정"?"▦":"✓"} {k}</button>)}</div></div>
      <label className="field-label">담당자<select value={form.assignee} onChange={e=>setForm({...form,assignee:e.target.value as Assignee})}><option value="함께">함께</option><option value="나">{myDisplayName}</option><option value="배우자">{partnerDisplayName}</option></select></label>
      <label className="field-label">메모 <span className="optional">(선택)</span><textarea rows={3} maxLength={500} value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="함께 기억할 내용을 적어두세요."/></label>
      <div className="modal-actions"><button type="button" className="cancel-button" onClick={()=>setModal(false)}>취소</button><button type="submit" className="save-button">{editing?"변경사항 저장":"계획 저장하기"}</button></div>
    </form></div>}
  </div>;
}
