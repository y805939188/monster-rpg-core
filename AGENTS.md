# Project rules

- Independent, single-package TypeScript monster RPG core; ESM and strict typing.
- Work only on approved scope. Owner approved and accepted F0–F9; initial release commit is 8ce567e09edf82d8df9a802d8b3b6b8532758d62. P1/P2 passed independent review. New dependent implementation still requires its applicable review gate; historical task restrictions describe their original stages.
- No Pokemon Essentials/MZ/Reactor/Showdown implementation, UI, monorepo, general plugin/DI framework or unrelated infrastructure.
- Review every feature for one narrow responsibility. Reject scope growth beyond its task card; prefer deleting or deferring unnecessary abstractions.
- Run serially. No implementation subagents, commits, pushes or publishing without authorization.
- Read applicable project Skills under `.agents/skills`; record their actual use. Apply only the current task’s relevant scope.
- Keep commands, outcomes, blockers and a proposed next card concise. Never store account/budget details here.
