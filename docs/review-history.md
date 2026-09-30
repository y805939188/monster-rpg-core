# Review gates and provenance

Owner approved the v2 F0–F9 serial roadmap. An approved roadmap does not bypass dependency review. F0 passed parent review of implementation/evidence under the approved low-risk self-review route. F1–F8 passed independent source/contract reviews; command execution throughout belongs to the implementer, not the reviewers. Early gates used snapshot hashes before the initial release commit 8ce567e09edf82d8df9a802d8b3b6b8532758d62; F0–F9 are now accepted.

| Gate | Accepted source snapshot SHA-256 |
|---|---|
| F1 | e52bb82f831715b90de190883d3e03adebdd5a30469a9ef45f9067bba7950691 |
| F2 | 3a2f5d16cf498fa5ac7c725d814faefc14297f43996b9ebf53cc30df3616e5a7 |
| F3 | 14c161e615d5e40e32fc1fd15d818b2c775d02e12001b021c6b82a2622cef081 |
| F4 | 358e89ca03f2be216c50686a56f7249ef697fdd46dba9f0b6b90ee67b3aa4610 |
| F5 | a2673fa90e929eee410da3a88aefc8d602d34ddd34b44e232e0b88bc512312f2 |
| F6-A | 79dc48f0e33ec9c7e2fddfb6e9ee169a8555b2f94e32c4899058d041c2393d9f |
| Full F6 | 31c9c450bb0dfaecbcedfbe79d709434325997edf29568e71091c1cb3afdd710 |
| F7-A | 286575377fe2a1c9e2e590aaf825a69694ef25bcc8a05e29388633d28e4427b7 |
| Full F7 | b2202bc55b30154efeb458b67df2ebb5b6b9fc84c87514a32a407636a86335a6 |
| F8 | 7a55afc613787e3bd73a49b2c53aa95bdcaebc30934d06bda13e70ac031d70ab |

F8 reviewer verified 99 section hashes, nine exact diffs, 63 current and 55 prior included entries; 35 historical/setup entries were omitted, not independently reverified. Fourteen prior source modules were unchanged. The 110 tests/builds/type checks/four examples were implementer execution. F8 manifest files were verified before F9; F9 introduces no production-source or dependency changes.

F6-A corrections allowed valid switch retaliation/terminal results and blocked actions after failed cleanup. F7 correction validated four ownership outputs against pending-defeat-recovery invariants. These regressions remain in the current tests. Earlier acceptance does not make the final F9 review automatic.

F9 is accepted as part of the initial release. The original preparation manifest
records historical input hashes and proposal status; P3 updates current baseline
status without rewriting that historical manifest. Older task cards retain their
stage-specific instructions; missing early cards are not reconstructed.

P1 independent review PASS verified packet
50a824c45c9e07a39e0e771a997bf94b1cb2a8f462963230e1154b5235c62ea5
and embedded hashes/diff against the initial commit. It accepted scoped catalog
reuse with input/output/alias/recovery invariants retained. Benchmark residual
switch cost remains unprofiled; no whole-pipeline linear scaling claim.

P2 independent static review PASS verified packet
45c48f13ca310989f4647f3e00dd8f3c6a181bd05c4c5d3b47d2dffe18905ac1,
diff fdbb82202f7d01b970300f1488be8cafe50d4aa3ec11e7343ce4a321023d07b0,
and 31 embedded files. Reverse diff matched accepted P1 source; 100 source
references were extensionless and 43 declaration references used .js with existing
targets. Reviewer did not run project commands or the AST comparator. All 118
tests, build/type/consumer checks and AST comparison remain implementer evidence.

P3 follows the explicitly approved low-risk documentation/configuration self-review
route, followed by full integration checks and authorized non-force GitHub push.
See tasks/P3.md for final verification evidence. No npm publication, deployment,
real-engine integration, or project license selection is included.
