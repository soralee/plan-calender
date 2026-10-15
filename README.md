# 우리의 캘린더 (plan-calender)

React + TypeScript + Vite로 만든 반응형 공유 캘린더입니다.

## 클라우드 저장소 설정

이 앱은 Supabase를 데이터베이스로 사용합니다. 현재 로그인 방식은 이메일 발송이나 회원가입 없이 캘린더 이름과 비밀번호를 입력하는 방식입니다.

1. Supabase의 **SQL Editor**에서 `supabase/schema.sql` 전체를 실행합니다.
2. **Authentication → Sign In / Providers**에서 **Anonymous Sign-Ins**를 활성화합니다.
3. **Project Settings → API**에서 Project URL과 publishable/anon key를 확인합니다.
4. Vercel의 Production 환경 변수에 `VITE_SUPABASE_URL`과 `VITE_SUPABASE_ANON_KEY`를 설정합니다.
5. `main`에 반영된 변경 사항이 배포될 때까지 기다립니다.

브라우저에는 publishable/anon key만 사용하세요. `service_role` 또는 secret key를 프런트엔드에 넣지 마세요.

**보안:** 브라우저용 publishable/anon key만 사용하세요. `service_role` 또는 secret key를 프론트엔드나 `VITE_*` 환경 변수에 절대 넣지 마세요. 데이터 테이블에는 Row Level Security(RLS) 정책이 적용되어 있습니다.

## 회원가입 없는 캘린더 이름 + 비밀번호 로그인으로 이전

기존 계정을 사용하는 중인 경우, **Auth 사용자를 삭제하기 전에** 다음 순서로 이전하세요.

1. 앱 코드 배포가 완료될 때까지 기다립니다.
2. Supabase SQL Editor에서 `supabase/password_login_migration.sql` 전체를 실행합니다.
3. 기존 계정으로 현재 앱에 로그인한 뒤, 캘린더 이름과 기존 비밀번호를 입력해 로그인합니다. 첫 로그인 시 기존 계정이 검증되고 비밀번호 해시가 캘린더에 저장됩니다.
4. 기존 계정으로 로그인에 성공한 뒤에만 Supabase Authentication → Users에서 기존 Auth 사용자를 삭제합니다. 이 SQL은 해당 사용자가 삭제되어도 캘린더와 일정이 삭제되지 않도록 참조를 정리합니다.
5. 이후 앱은 Anonymous Sign-Ins를 사용하며, 캘린더 이름과 비밀번호를 서버에서 검증합니다. 계정 설정의 비밀번호 변경도 캘린더 비밀번호 해시를 갱신합니다.

**중요:** 기존 사용자를 먼저 삭제하지 마세요. 비밀번호 이전이 완료되기 전에 삭제하면 기존 비밀번호를 검증할 수 없어 새 로그인 방식으로 전환하기 어려울 수 있습니다. SQL 실행 또는 첫 이전 로그인에서 오류가 나면 사용자를 삭제하지 말고 오류 내용을 확인하세요.

이 로그인 방식은 계정 복구 이메일을 사용하지 않습니다. 비밀번호를 잊으면 복구가 어려우므로 안전하게 보관하세요. 공개되거나 추측하기 쉬운 캘린더 이름/비밀번호를 사용하지 마세요.

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
