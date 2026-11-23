# Kế hoạch đưa NEXUS Desktop sát giao diện Codex desktop

## 1. Hiện trạng đã kiểm chứng

Đã bật Codex desktop thật (`chatgpt` 26.1111.21308, tiến trình `/usr/lib/chatgpt/ChatGPT`) và chụp màn hình:
`/home/thinkpad/.hermes/cache/images/computer_use_3bc5ad97d8d34ad5a19fa347e9348afb.png`

Đã chụp NEXUS Desktop (Playwright, 1280x820): `/tmp/nexus-ui.png`

NEXUS **đã giống Codex ở phần nền**:

- `apps/desktop/src/renderer/src/styles/globals.css:1-3` ghi rõ token màu được trích từ Codex desktop đang chạy (`captures/codex-vars-light.json`, `codex-vars-dark.json`), bộ github light/dark, rail 52px, panel 340px, radius composer 22px.
- `Sidebar.tsx:246` rail icon trái; `Sidebar.tsx:302` panel New chat / Pinned / Projects / Recents.
- `TabStrip.tsx:7` tab phiên = "Show tabs" của Codex.
- `ChatPage.tsx:296-327` nút Outputs / Create an output / Summary; `ChatPage.tsx:401` pane Outputs bên phải.
- Composer đã dùng placeholder `Do anything` (`HomePage.tsx:147`), menu row kiểu Codex.

## 2. Khác biệt còn lại (Codex vs NEXUS)

| Khu vực      | Codex desktop (quan sát trực tiếp)                | NEXUS hiện tại                                                                                            | Mức ưu tiên         |
| ------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------- |
| Rail trái    | Home / history / profile; gear settings ở cuối    | Home / Scheduled / Plugins / Explore; hide-sidebar ở cuối; tài khoản nằm dưới panel                       | Cao                 |
| Header panel | "Codex" + dropdown switcher                       | không có header, chỉ New chat                                                                             | Cao                 |
| Empty state  | "What should we build?" + cloud glyph             | "Xin chào! Bạn có thể làm gì?" / "What should we work on in <project>?" + Blossom (`HomePage.tsx:86-133`) | Trung bình          |
| Composer     | gọn: `+`, info, dropdown theme/model, mũi tên gửi | nhiều chip inline: Choose project, Add files, Change mode, Change permissions (`Composer.tsx:766-889`)    | Cao                 |
| Pane phải    | document/artifact viewer có tab (đang mở PDF)     | Outputs 260px, chỉ liệt kê file-change (`ChatPage.tsx:401-423`)                                           | Cao nhất            |
| Menu native  | File / Edit / View / Help                         | thêm Search / Theme / Toggle terminal                                                                     | Thấp                |
| Ngôn ngữ     | tiếng Anh                                         | trộn EN/VI                                                                                                | Quyết định cần chốt |

## 3. Các phase thực hiện

### Phase 0 — Chốt 2 quyết định (trước khi sửa code)

1. Giữ tiếng Việt (đề xuất) hay chuyển hẳn tiếng Anh để đồng bộ 100% với Codex?
2. Chỉ chỉnh bố cục, hay cả nâng pane Outputs thành artifact/document viewer thật?

### Phase 1 — Rail + sidebar đúng Codex

- `Sidebar.tsx:246-291`: thay 3 nút Scheduled/Plugins/Explore bằng history (mở recent) + profile; chuyển Scheduled/Plugins vào menu phụ hoặc command palette (vẫn giữ route).
- `Sidebar.tsx:479-505`: đưa nút tài khoản vào profile popover trên rail, để gear settings ở cuối rail như Codex.
- `Sidebar.tsx` đầu panel: thêm header "NEXUS" + dropdown chuyển project/workspace (dùng API `projects.list` sẵn có).
- Giữ nguyên token CSS; chỉ đổi cấu trúc.

### Phase 2 — Home + composer sát Codex

- `HomePage.tsx:86-133`: thống nhất empty state theo wording Codex, bản tiếng Việt nhất quán ("Bạn muốn xây dựng gì?" / "Bạn muốn làm gì với <project>?"). Giữ Blossom hoặc thay cloud glyph.
- `Composer.tsx:766-889`: gom project/mode/permission vào 1 chip popover kiểu `agent · ghi dự án`, để lại `+`, info, dropdown model/theme, nút gửi — đúng mật độ Codex.
- Cập nhật E2E `tests/e2e/app.spec.ts` (các assertion `Choose project`, `Change mode`, `Change permissions`, `New chat`).

### Phase 3 — Pane phải: Outputs → artifact/document viewer (việc lớn nhất)

- `ChatPage.tsx:401`: đổi pane 260px cố định thành pane có thể kéo rộng, có tab: `Changes | Outputs | Preview`.
- Component mới `components/chat/ArtifactPanel.tsx`: preview HTML/SVG/image/Markdown/PDF bằng iframe `sandbox` trong rendererElectron (không dùng `file://` trực tiếp; đọc qua IPC `workspace.readFile` rồi tạo blob URL).
- Giữ `Changes` dùng dữ liệu `taskDetail.fileChanges` sẵn có; click đổi sang diff (`lib/diff.ts`).

### Phase 4 —Conversation + menu polish

- `Conversation.tsx`, `ChangeCard.tsx`, `ApprovalDialog.tsx`: so sánh với 1 task chạy thật trên Codex, chỉnh spacing/typography card cho khớp (ưu tiên nhỏ).
- `ApplicationMenuBar.tsx`: cân nhắc gom Search/Theme/Terminal vào View menu để thanh menu giống File/Edit/View/Help.

### Phase 5 — Verification (bắt buộc)

- `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`
- `xvfb-run -a npx playwright test` (hiện 10/10 pass — không được regress)
- Chụp lại NEXUS 1280x820 đặt cạnh ảnh Codex ở trên, so sánh từng khu vực trong bảng §2.

## 4. Trạng thái triển khai (đã làm)

- Phase 1 xong: rail Home/Lịch sử/Profile/gear, header "NEXUS" + switcher project, bỏ account block dưới panel (`Sidebar.tsx`).
- Phase 2 xong: empty state tiếng Việt, composer gom project/mode/permission vào 1 chip `Tùy chọn tác vụ` (`HomePage.tsx`, `Composer.tsx`).
- Phase 3 xong: pane bên phải `ArtifactPanel` với tab Changes/Preview, resize, diff + iframe sandbox cho HTML/SVG (`components/chat/ArtifactPanel.tsx`, `ChatPage.tsx`).
- Phase 4: menu File/Edit/View/Help + Search/Theme/Terminal vốn đã khớp Codex (ảnh chụp), không đổi.
- Chưa làm: parity hành vi chat nội bộ (prompt/protocol) — chỉ đồng bộ giao diện và flow tương tác.
- Settings đã chỉnh theo reference: rail-only (ẩn sidebar chat), nav nhóm `Personal / Integrations / Coding`, giữ search + heading (`App.tsx`, `Sidebar.tsx`, `SettingsPage.tsx`).
- UI tài khoản/đăng nhập đã bỏ (`Sidebar.tsx`), E2E đổi sang nút gear `Cài đặt`.
- Settings phủ toàn bộ taxonomy Codex: `Archived chats`, `Storage`, `Configuration`, `Keyboard shortcuts`, `Plugins`, `Connections`, `Git`, `Personalization`, `Import`, `Voice`, `Mini & Pets`, `Browser`, `Computer use`, `Cloud`, `Environments` (`SettingsExtras.tsx`, `SettingsPage.tsx`).
- Chức năng thật: accent đổi CSS ngay, `env.vars` lưu vào settings và được merge vào env khi spawn MCP (`mcp.ts:213`), Import áp dụng JSON qua `settings.set`, Archived khôi phục session, Pet render trong `App.tsx`.
- Mục cần cloud (Cloud tasks, Browser integration, Computer use runtime) chỉ hiển thị trạng thái trung thực — không tạo toggle giả; không copy asset OpenAI.
- Logo: xoá `Blossom.tsx` (knot kiểu Codex), thay bằng `NexusLogo.tsx` (lục giác + chữ N) ở Home và avatar assistant.
- Phong cách chat: system prompt đổi từ Claude Code sang Codex (`agent.ts:1537,1621`) — kết quả trước, câu ngắn, ít Markdown, không emoji; Conversation dùng chữ 14.5/1.65, bỏ icon Sparkles ở reasoning; xoá `ClaudeMark.tsx` còn sót.
- Sắp xếp theo STT: `lib/task-status.ts` xếp ưu tiên running → waiting → queued → planning → idle → failed → cancelled → completed; sidebar đưa phiên đang chạy lên đầu (`Sidebar.tsx:148`), lệnh `/tasks` liệt kê có STT theo trạng thái (`slash.ts:357`).
- Chạy lệnh kiểu Codex: kết quả slash command hiện thành card inline `› /lenh` ngay trong transcript (`app-store.ts` commandLog/pushCommand, `slash.ts:71`, `Conversation.tsx:599`); toast vẫn giữ cho E2E.
- Bash/tool nối tiếp: `ToolDetail` mở output mặc định, hiện `$ lenh` rồi output ngay dưới; bỏ header gom nhóm `Đã chạy N lệnh` trong `ToolGroup` (`Conversation.tsx:61-118`). Probe DB xác nhận thứ tự user → lệnh1 → output1 → lệnh2 → output2 → assistant.
- Thinking nối tiếp: bỏ điều kiện lọc bỏ assistant message có reasoning nhưng rỗng content (`Conversation.tsx:365`) — giờ transcript là `Đã suy nghĩ → $ lenh → output → Đã suy nghĩ → $ lenh → output`, đúng Codex. Probe DB xác nhận `think->cmd->think->cmd: true`.
- Streaming: 4 SSE reader trong `providers.ts` dùng `node:string_decoder` (StringDecoder) thay vì `chunk.toString('utf8')` — không gãy byte tiếng Việt khi chunk cắt giữa ký tự; gọi `decoder.end()` trước khi xử lý buffer cuối. Nhịp flush core 12ms → 16ms khớp renderer (`agent.ts:2403`), giảm ~25% event IPC. Probe HTTP SSE thật với chunk cắt giữa "chào" trả đúng `Xin chào thế giới — streaming ổn định.`, `utf8 clean: true`.
- Gộp delta: `agent.delta` mới chứa cả text + reasoning trong 1 event (`events.ts`, `agent.ts:2378`, `realtime.ts`, `app-store.ts appendLivePair`) — tối đa 1 event/flush thay vì 2, giảm 50% serialize IPC. Đây là cơ chế, chưa benchmark tốc độ thực tế.
- Sub-agent `librarian`: role chuyên thư viện ngoài trong orchestrator (`types.ts`, `agent.ts:466/485/1840/3293`), truyền qua `delegate_task(role:'librarian')` (`tools.ts:2258`); prompt riêng yêu cầu verify version/API/license/size bằng `web_search`. Test core pin role + tool schema (28/28).
- Self-improving Skills: bảng `agent_skills` + CRUD trong `store.ts` (save cùng tên tự tăng version, bump use_count, search/xoá); IPC `skill.*` trong `ipc.ts`/`ipc-schemas.ts`/`index.ts`/`api.ts`; agent tự lưu quy trình khi task hoàn thành (`agent.ts:3848`) và inject 5 skill có dùng nhiều nhất vào system prompt (`agent.ts:1676`); Settings → Coding → Self-improving Skills để xem/sửa/xoá (`SettingsExtras.tsx`, `SettingsPage.tsx`). Test store 29/29; probe UI thêm skill → hiện danh sách, `skill.list` trả `probe-skill` v1.
- Lệnh `/subagent`: builtin command có args (`slash-parse.ts`), nhận `/subagent [vai trò] <prompt>` hoặc `--role=`; gọi IPC `agent.delegate` → `AgentRuntime.delegateStandalone` → `startSubagent` với prompt riêng của role (`agent.ts:1319`, `index.ts:656`, `ipc.ts`). Probe UI: lệnh trần điền `/subagent `, có prompt báo "Không chạy được sub agent" khi chưa cấu hình provider (đúng đường dẫn).
- Tool `subagent` cho AI: `tools.ts:2272` định nghĩa tool (prompt/title/role/mode/permissionMode), runtime dùng chung nhánh với `delegate_task` (`agent.ts:3152`) nên agent tự gọi được; có trong TOOL_PRIORITY và normalize prompt. Probe `agent.toolList` thật: `subagent tool listed: true`.
- Browser Automation: `browser.ts` quản lý phiên Chromium headless (chrome channel, override bằng `NEXUS_BROWSER_EXECUTABLE`), chỉ cho http/https, timeout, đóng khi shutdown; 8 tool `browser_*` (`tools.ts`) được runtime intercept qua `executeTool` (`agent.ts`); IPC `browser.call` + UI thật trong Settings → Integrations → Browser (mở URL, đọc text/CSS selector, chụp ảnh, đóng). Lưu ý bundle: phải dùng `createRequire(process.cwd()/package.json)` thay vì dynamic import để resolve `@playwright/test`. Probe app thật với server local: `read before: chua gui`, fill+click → `read after: da gui: NEXUS`, screenshot path hợp lệ, list 1→0 sau close, `file://` bị chặn. Test URL validation + tool registry (31/31).
- Automation / Cron (tính năng 4): `cron.ts` tính lịch 5 trường (hỗ trợ `*` / range / `*/step`), `CronManager` tick mỗi 30s, chạy task riêng qua `agent.runAutomation`, gửi kết quả webhook/Discord/Telegram (`deliver`), token Telegram lưu ở setting `automation.telegramToken`; IPC `automation.*` đã nối 5 lớp từ trước. Phần còn thiếu đã nối xong: UI thật Settings → Integrations → Automation / Cron (`SettingsExtras.tsx` `AutomationPanel`, đăng ký route trong `SettingsPage.tsx`): tạo lịch, mẫu báo cáo, bật/tắt, chạy ngay, xoá, test kênh, lưu token; đọc đúng cột snake_case `next_run_at`/`last_run_at` từ store. Test cron 6 ca (tính lịch, validate, webhook/discord qua HTTP server local, telegram mock, tick/runNow/failed event) — tổng 42/42. Probe Electron thật: create→list 1→update→testChannel webhook 200 + payload nhận được→run (báo đúng `No enabled provider/model` vì chưa cấu hình provider)→remove→list 0; UI hiện tên lịch và "Lần chạy tiếp".
- Multi-Agent (tính năng 3): mỗi sub-agent có session riêng (context) và giờ có thêm PTY riêng do `TerminalManager` tạo với `owner = taskId` (`terminal.ts` thêm `read()` ring-buffer 32KB, `listForOwner()`, tag `owner`); tool `agent_terminal_read` / `agent_terminal_write` chỉ tác động terminal của chính task đó (intercept trong `AgentRuntime.executeTool`), đóng khi task xong/huỷ/shutdown. Bảy vai trò chuyên môn (planner/researcher/coder/debugger/reviewer/tester/librarian) đều có brief riêng (`roleBrief`), không chỉ role-play trong 1 prompt. `orchestratorRun` giờ khởi động các chuyên gia được chọn song song rồi `Promise.all` chờ tất cả, gộp báo cáo vào session cha; `delegate_parallel` cũng chờ song song và truyền `role`/`terminalId` cho từng con. Test: brief 7 role, tool registry, validation orchestrator, terminal owner/read/dispose — 42/42. Lưu ý: chưa chạy end-to-end với provider thật, nên luồng sinh task con chỉ được kiểm chứng ở lớp core/probe IPC, không phải hội thoại model thật.

## 5. Rủi ro / lưu ý

- Không sao chép tài sản độc quyền của OpenAI: chỉ tự dựng lại bố cục + token màu đã trích trước đó trong repo.
- E2E phụ thuộc nhãn aria; mỗi đổi nhãn phải đổi assertion tương ứng.
- Pane Preview cần chặn script độc hại: luôn `sandbox` iframe + CSP hiện tại (`main/index.ts:173-186`).
- Disk đang 92% đầy; không tải thêm runtime Codex (~390MB) nếu không cần thiết — ảnh chụp đã đủ để đối chiếu.
