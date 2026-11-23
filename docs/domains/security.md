# Cybersecurity — IMPLEMENTED + TESTED (scope nmap loopback, authorized-only)

Adapter: `packages/core/src/domains/security/index.ts`

## Có thật (2026-11-19)

- nmap 7.98 AVAILABLE — scan `127.0.0.1` được chạy thật, exit 0 (output có `18766/tcp`).
- `project.create` → `scan.sh` (hardcode loopback, từ chối tham số port không hợp lệ), `targets.txt` (127.0.0.1), `SECURITY.md`.
- `build` → `sh -n scan.sh`; `test` → `sh scan.sh 18766` (nmap loopback, ghi `scan.txt`). Unit IPC test pass.

## Chưa có

- Semgrep, Trivy, gitleaks, Bandit, tshark, YARA: MISSING — cài cần xác nhận (pip/apt theo DEPENDENCY_MATRIX.md).
- SAST/secret/dependency scan adapter, packet inspector, web-analyzer.
- CTF sandbox / malware analysis.

## Ràng buộc (bắt buộc)

- **Chỉ quét hệ thống bạn sở hữu hoặc được ủy quyền.** Scaffold quét duy nhất `127.0.0.1`; không mở rộng target.
- Không attack mạng ngoài, không spoof, không exploit thật.

## Verify

```sh
pnpm run test   # domain.test.ts: security → sh -n → nmap loopback exit 0
```

Permission gate: `packages/core/src/security.ts` (risk=network).
