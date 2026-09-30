# Review gates and provenance

Owner approved the v2 F0–F9 serial roadmap. An approved roadmap does not bypass dependency review. F0 passed parent review of implementation/evidence under the approved low-risk self-review route. F1–F8 passed independent source/contract reviews; command execution throughout belongs to the implementer, not the reviewers. No commit exists: hashes identify snapshots.

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

F9: self-review PASS; independent final review pending, overall status REVIEWING. Preparation Skills and gameplay baseline are preserved byte-for-byte with their original provenance manifest. Historical proposal wording does not revoke later approval. Task cards document stage-specific scope; their former gate text is historical. Final archive selects current implementation, tests/examples, current guidance and necessary provenance rather than copying old complete review packets. Recoverable repository files were not deleted.
