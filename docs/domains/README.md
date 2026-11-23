# Domain docs — trạng thái thật

Source of truth: [../../DOMAIN_SUPPORT_MATRIX.md](../../DOMAIN_SUPPORT_MATRIX.md) + [../../DEPENDENCY_MATRIX.md](../../DEPENDENCY_MATRIX.md). Mọi file ở đây trích lại từ matrix; không file nào khẳng định xong cả khi chưa có integration test.

Chú giải: **IMPLEMENTED + TESTED** = có scaffold/build/test chạy thật; **REQUIRES INSTALL** = cần cài tool có xác nhận, đã có adapter + honest failure; **UNSUPPORTED** = không áp dụng cho OS/môi trường này.

| Domain            | Trang                      | Trạng thái                           | Bằng chứng ngắn          |
| ----------------- | -------------------------- | ------------------------------------ | ------------------------ |
| Web               | [web.md](web.md)           | IMPLEMENTED + TESTED                 | E2E `e2e-domain-web`     |
| Backend & Systems | [systems.md](systems.md)   | IMPLEMENTED + TESTED (C/C++)         | E2E `e2e-domain-sys`     |
| AI & ML           | [aiml.md](aiml.md)         | IMPLEMENTED + TESTED (PyTorch smoke) | E2E `e2e-domain-aiml`    |
| Database & Data   | [database.md](database.md) | IMPLEMENTED + TESTED (node:sqlite)   | unit IPC test            |
| DevOps & Cloud    | [devops.md](devops.md)     | IMPLEMENTED + TESTED (compose/YAML)  | unit IPC test            |
| Cybersecurity     | [security.md](security.md) | IMPLEMENTED + TESTED (nmap loopback) | unit IPC test            |
| Desktop & OS      | [desktop.md](desktop.md)   | IMPLEMENTED + TESTED (Qt 6)          | E2E `e2e-domain-desktop` |
| Embedded & IoT    | [embedded.md](embedded.md) | PARTIAL + REQUIRES TOOLCHAIN INSTALL | unit IPC honest-fail     |
| Game              | [game.md](game.md)         | REQUIRES INSTALL                     | unit IPC honest-fail     |
| Mobile            | [mobile.md](mobile.md)     | REQUIRES INSTALL / iOS UNSUPPORTED   | unit IPC honest-fail     |

Bước 5 (domain-aware agent): deterministic intent router IMPLEMENTED + TESTED; provider-based classification + auto tool-selection theo capability chưa xong — xem [../../IMPLEMENTATION_PLAN.md](../../IMPLEMENTATION_PLAN.md).

Rollback: DependencyManager tự rollback khi verify-after-install fail (`dependency_events` action=`rollback`), audit log đầy đủ — xem [../architecture/domain-engine.md](../architecture/domain-engine.md).
