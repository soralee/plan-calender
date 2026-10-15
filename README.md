# 우리의 캘린더 (plan-calender)

React + TypeScript + Vite로 만든 반응형 공유 캘린더입니다.

## 클라우드 저장소 설정

이 앱은 Supabase를 데이터베이스와 로그인 서비스로 사용합니다. 저장소에 SQL 스키마와 앱 코드는 준비되어 있지만, 실제 클라우드 연결을 위해서는 개인 Supabase 프로젝트를 한 번 설정해야 합니다.

1. [Supabase](https://supabase.com/)에서 프로젝트를 생성합니다.
2. Supabase의 **SQL Editor**에서 `supabase/schema.sql` 전체를 실행합니다.
3. **Authentication → Providers → Email**에서 이메일 확인(Confirm email)을 비활성화합니다. 이 MVP는 이메일 주소 대신 이름을 로그인 식별자로 쓰고 내부적으로 이메일 형식 ID를 생성합니다.
4. **Project Settings → API**에서 Project URL과 publishable/anon key를 확인합니다.
5. Vercel에서 **plan-calender → Settings → Environment Variables**에 다음 변수를 추가하고 Production 환경을 선택합니다.
   - `VITE_SUPABASE_URL`: Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY`: Supabase publishable key 또는 anon key
6. Vercel에서 재배포합니다. 로컬 개발을 한다면 프로젝트 루트의 `.env.local`에도 같은 두 변수를 설정하세요.

**보안:** 브라우저용 publishable/anon key만 사용하세요. `service_role` 또는 secret key를 프론트엔드나 `VITE_*` 환경 변수에 절대 넣지 마세요. 데이터 테이블에는 Row Level Security(RLS) 정책이 적용되어 있습니다.

## 이름 + 비밀번호 로그인

- 첫 기기에서 **캘린더 만들기**를 선택하고 이름과 8자 이상 비밀번호를 설정합니다.
- 다른 기기에서는 **같은 이름과 비밀번호**로 로그인합니다. 두 기기는 같은 클라우드 캘린더를 공유합니다.
- 이름은 로그인 식별자라서 중복으로 만들 수 없습니다. 다른 사람이 쉽게 추측할 이름은 피하세요.
- 이 MVP는 이메일을 통한 비밀번호 재설정 기능이 없습니다. 비밀번호를 잊으면 복구가 어려우므로 안전하게 보관하세요.
- 이 방식은 한 쌍이 동일한 로그인 자격 증명을 공유하는 방식입니다. 향후에는 각자 별도 계정과 초대 코드로 공유하도록 개선할 수 있습니다.

## 기존 일정 이전

처음 로그인했을 때 클라우드 캘린더가 비어 있고 현재 브라우저에 기존 일정이 있으면, 일정들을 클라우드로 가져올지 확인합니다. 가져오지 않아도 기존 브라우저 데이터는 JSON 백업 기능으로 보관할 수 있습니다.

JSON 백업/가져오기 기능은 유지됩니다. 일정 추가, 수정, 완료 상태 변경, 삭제는 클라우드에 반영되고 다른 기기에도 실시간 업데이트됩니다.

## 개발

```bash
npm install
npm run dev
npm run build
```
## 배포 자동화 확인

`main` 브랜치에 커밋이 올라오면 GitHub Actions의 `Build check`가 `npm run build`를 실행합니다. Vercel 프로젝트의 Git 저장소 연결과 Production Branch도 `main`으로 설정되어 있어야 커밋마다 자동 배포됩니다.
