# NEXUS Desktop — MCP và Slash Commands

Tài liệu này mô tả hai bề mặt người dùng được bổ sung gần đây: tích hợp Model Context Protocol
(MCP) và hệ thống slash command trong composer. Nội dung bám theo mã nguồn hiện tại; mọi tên
channel, khoá cấu hình và tên lệnh đều là giá trị thật trong repo.

## 1. Tổng quan kiến trúc

MCP được triển khai theo đúng phân lớp của dự án:

```
Renderer (React)                Electron main                @nexus/core (TS)
─────────────────               ─────────────                ────────────────
Settings → MCP servers   ──▶  IPC allowlist + Zod   ──▶  McpManager
composer slash command         typed contract               spawn stdio / HTTP / SSE
```

- Cấu hình server nằm trong setting `mcp.servers` (SQLite của core), không phải file rời.
- Renderer chỉ gọi IPC; không có quyền spawn process.
- `nexus-core` sở hữu vòng đời process, giao thức JSON-RPC và danh sách tool.

## 2. Transport được hỗ trợ

| Transport       | Trường cấu hình                 | Ghi chú                                                      |
| --------------- | ------------------------------- | ------------------------------------------------------------ |
| stdio           | `command`, `args`, `env`, `cwd` | Process cục bộ, giao tiếp JSON-RPC qua stdin/stdout.         |
| Streamable HTTP | `url` (mặc định khi có `url`)   | POST JSON-RPC; nhận cả phản hồi JSON và `text/event-stream`. |
| SSE (legacy)    | `url` + `transport: "sse"`      | `GET` stream, chờ event `endpoint` rồi POST message vào đó.  |

Mọi transport đều nhận thêm `headers` (object khoá → giá trị) để gửi token xác thực, và `enabled`
để bật/tắt mà không xoá cấu hình.

Ví dụ:

```json
[
  {
    "id": "filesystem",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "~"]
  },
  {
    "id": "github",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_…" }
  },
  { "id": "deepwiki", "url": "https://mcp.deepwiki.com/mcp" },
  {
    "id": "legacy",
    "url": "https://example.com/sse",
    "transport": "sse",
    "headers": { "Authorization": "Bearer …" }
  }
]
```

## 3. Hợp đồng IPC

Ba channel mới trong `packages/shared/src/ipc.ts`, có schema Zod tương ứng trong
`packages/shared/src/ipc-schemas.ts`:

| Channel       | Input           | Output                                                                                     |
| ------------- | --------------- | ------------------------------------------------------------------------------------------ |
| `mcp.servers` | —               | `McpServer[]` (`id`, `command`, `args`, `url`, `transport`, `enabled`, `status`, `error?`) |
| `mcp.tools`   | `{ serverId? }` | `McpTool[]` (`namespacedName`, `description`, `inputSchema`, …)                            |
| `mcp.restart` | —               | `null` — core nạp lại toàn bộ server                                                       |

Việc thêm, sửa, bật/tắt server dùng channel sẵn có `settings.set` với khoá `mcp.servers`; core
phát hiện thay đổi và nạp lại (`rpc.cpp`, nhánh `settings.set`).

## 4. Hành vi trong core

`packages/core/src/mcp.ts` triển khai các điểm sau:

- **Khởi động lười (lazy spawn):** server chỉ được spawn khi có nhu cầu (agent dùng tool, hoặc
  người dùng bấm “Xem tool”). Vì vậy `mcp.servers` không tự chạy process.
- **Đặt tên tool:** tool của MCP xuất hiện với agent dưới dạng `mcp__<serverId>__<toolName>`;
  ký tự ngoài `[a-zA-Z0-9_-]` được thay bằng `_`.
- **Phiên HTTP:** `Mcp-Session-Id` trả về trong header được lưu lại và gửi kèm các request sau;
  header `MCP-Protocol-Version: 2024-11-05` luôn được gửi.
- **Phản hồi SSE trong Streamable HTTP:** nếu body chứa `data:` thì thư viện lấy object JSON hợp lệ
  cuối cùng có `result`/`error`.
- **Báo lỗi:** lý do khởi động thất bại (spawn, `initialize`, `tools/list`) được lưu và trả về ở
  trường `error` của `mcp.servers`, thay vì thất bại im lặng.
- **Chẩn đoán stderr:** 8000 ký tự cuối của stderr (stdio) được giữ trong process, `mcp.servers`
  trả về 2000 ký tự cuối ở trường `stderr` để xem log server ngay trong UI.
- **Dừng an toàn:** server HTTP không có process nên `stop()` không gửi tín hiệu; server SSE được
  dừng bằng cờ `stop_stream` để thread đọc thoát khỏi `curl`.
- **OAuth (`src/mcp_oauth.cpp`):** khi request trả `401`, core xoá access token và báo lỗi
  `E_AUTH`; người dùng bấm “Kết nối”. Luồng thực hiện: đọc protected-resource metadata
  (RFC 9728) → authorization-server metadata (RFC 8414, fallback OpenID Connect) → dynamic client
  registration → PKCE `S256` → mở listener `127.0.0.1:<cổng ngẫu nhiên>` → đổi code lấy token.
  Token lưu mã hoá (AES-256-GCM qua `SecretStore`) trong setting `mcp.oauth`; request HTTP/SSE tự
  gắn `Authorization: Bearer …` khi server chưa khai báo header đó. Access token hết hạn sẽ được
  gia hạn bằng `grant_type=refresh_token` trước khi báo lỗi.

## 5. Giao diện

`Settings → AI → MCP servers` (`components/settings/McpPanel.tsx`) cung cấp:

- Danh sách server: trạng thái runtime (`đang chạy · N tool`, `chưa chạy`, `đã tắt`), target
  (`command …` hoặc URL), lý do lỗi nếu có.
- Với server dùng URL: khối OAuth trong vùng mở rộng hiển thị `đã kết nối`/`chưa kết nối`, nút
  “Kết nối” (mở trình duyệt, tự làm mới trạng thái tới khi xong) và “Đăng xuất”.
- Hành động: xem tool (kèm stderr gần nhất), **kiểm tra kết nối** cho riêng server
  (spawn + `initialize` + `tools/list`, báo số tool hoặc lỗi), sửa, bật/tắt, xoá (có xác nhận);
  nút “Khởi động lại” gọi `mcp.restart`.
- Catalog connector thêm một bước: Filesystem, Memory, GitHub, Fetch, Brave Search, Slack,
  Puppeteer, DeepWiki (từ xa).
- Form thủ công: `ID`, `Command`, `Args`, `URL`, `Transport` (Streamable HTTP / SSE), `Headers`,
  `Env`. `ID` được kiểm tra theo `[a-zA-Z0-9_-]{1,64}` vì nó đi vào tên tool.

## 6. Slash command trong composer

`lib/slash-parse.ts` (thuần, có self-check) và `lib/slash.ts` (thực thi) cung cấp:

Nhóm lệnh phiên:

| Lệnh                 | Tác dụng                                          |
| -------------------- | ------------------------------------------------- |
| `/new`               | Tạo phiên mới                                     |
| `/undo`              | Hoàn nguyên lượt trước, đưa lại prompt vào ô nhập |
| `/fork`              | Nhân bản phiên hiện tại                           |
| `/compact [ghi chú]` | Gửi yêu cầu tóm tắt hội thoại để giảm context     |
| `/export`            | Sao chép hội thoại dạng Markdown                  |

Nhóm lệnh cho coding agent:

| Lệnh              | Tác dụng                                                                     |
| ----------------- | ---------------------------------------------------------------------------- |
| `/init`           | Khảo sát repo rồi tạo/cập nhật `AGENTS.md` (build, test, quy ước)            |
| `/plan <việc>`    | Chuyển phiên sang chế độ `plan` và gửi yêu cầu lập kế hoạch trước khi sửa mã |
| `/review`         | Gửi diff chưa commit cho agent review, nêu bug và chỗ thiếu test             |
| `/fix <mô tả>`    | Yêu cầu sửa lỗi và chạy lại phần kiểm tra liên quan                          |
| `/test [phạm vi]` | Chạy test và sửa lỗi nếu hỏng                                                |
| `/commit <msg>`   | Stage toàn bộ tệp thay đổi rồi commit với message cho trước                  |
| `/diff`           | Sao chép `git diff` chưa commit vào clipboard                                |
| `/status`         | Báo nhánh, số tệp thay đổi, ahead/behind                                     |
| `/stop`           | Huỷ tác vụ đang chạy                                                         |
| `/resume [id]`    | Tiếp tục tác vụ bị gián đoạn hoặc thất bại                                   |
| `/context`        | Xem mức dùng context của tác vụ hiện tại                                     |
| `/help`           | Liệt kê toàn bộ lệnh (built-in và lệnh riêng)                                |

Nhóm lệnh cấu hình:

| Lệnh              | Tác dụng                                                       |
| ----------------- | -------------------------------------------------------------- |
| `/model <tên>`    | Đổi model của phiên (không tham số: liệt kê model khả dụng)    |
| `/agent [chế độ]` | Đổi chế độ agent; không tham số thì chuyển sang chế độ kế tiếp |
| `/connect`        | Mở cài đặt provider/model                                      |
| `/mcp`            | Mở mục MCP servers                                             |
| `/reload`         | Nạp lại cấu hình, model, provider                              |

Các lệnh git (`/commit`, `/diff`, `/status`, `/log`, `/branch`, `/sync`, `/push`, `/discard`) yêu
cầu dự án đang mở; nếu chưa có, ứng dụng báo
“Cần mở một dự án trước”. `/plan` gửi tác vụ ở chế độ `plan` ngay cả khi phiên đang ở chế độ khác.

Ngoài ra mọi file `.md` trong `.nexus/commands` hoặc `.claude/commands` (theo project và theo
`$HOME`) trở thành lệnh riêng; template hỗ trợ tham số `$ARGUMENTS`.

Menu lệnh nằm phía trên hộp soạn (nên hộp soạn không dùng `overflow: hidden`). Cho phép khoảng
trắng thừa trước dấu `/`; xoá hết nội dung sẽ đặt lại trạng thái đóng menu.

Phím tắt trong menu: `↑`/`↓` di chuyển, `Enter`/`Tab` chạy lệnh đang chọn (lệnh có tham số thì
điền sẵn `/tên `), `Esc` đóng menu. Gõ thêm ký tự đưa con trỏ về mục đầu. Kết quả được xếp hạng:
trùng tên trước, rồi khớp đầu tên, rồi khớp mô tả. Tên lệnh không tồn tại được gửi như prompt.

## 7. Cordis

Kernel renderer (`kernel/index.ts`) cung cấp các service `api`, `query`, `store`, `mcp`, và hai
plugin: `nexus.realtime` (cầu nối event) và `nexus.mcp` (làm mới danh sách server/tool khi core phát
event `mcp.server.status`).

Service được `kernel.provide(...)` với nguyên bản đối tượng, đồng thời re-export từ `kernel` để
feature chỉ cần một điểm vào: `import { api, queryClient, qk, useAppStore, useT } from '../kernel'`.
Toàn bộ component, page và lib nghiệp vụ (`actions`, `slash`) đã chuyển sang lối này.

Ba tệp cố ý giữ import trực tiếp vì chúng là nguồn của service hoặc nằm trong chuỗi khởi tạo kernel:

| Tệp                  | Lý do                                                            |
| -------------------- | ---------------------------------------------------------------- |
| `lib/api.ts`         | Định nghĩa service `api`.                                        |
| `lib/query.ts`       | Định nghĩa `queryClient`/`qk`.                                   |
| `store/app-store.ts` | Định nghĩa store; phụ thuộc `api` để gọi IPC.                    |
| `lib/realtime.ts`    | Được `plugin-realtime` nạp; import kernel sẽ tạo vòng phụ thuộc. |
| `lib/mcp.ts`         | Là chính service `mcp` mà kernel provide.                        |

## 8. Kiểm chứng

```bash
pnpm run verify        # tsc -b + eslint + core tests + electron-vite build
npx playwright test    # 8 kịch bản e2e
node --experimental-strip-types \
  apps/desktop/src/renderer/src/lib/slash-parse.check.ts
```

Bộ e2e bao phủ: danh sách/tool MCP qua IPC, thêm và sửa server trong UI (kèm kiểm tra ID và việc xoá
transport cũ), server stdio hỏng kèm lý do lỗi, server streamable HTTP cục bộ (JSON + SSE), server
SSE legacy, và toàn bộ luồng slash command.

## 9. Giới hạn đã biết

- **OAuth** tự refresh bằng `refresh_token` khi access token hết hạn; nếu provider không cấp
  refresh token thì phải bấm “Kết nối” lại.
- **Cordis** mới bọc MCP và realtime; khoảng 17 file renderer vẫn import `api`/`store` trực tiếp.
- **Chuỗi tham số có dấu cách** (ví dụ đường dẫn chứa space) chưa hỗ trợ trong ô `Args`; cần tách
  theo dấu cách đơn giản.
