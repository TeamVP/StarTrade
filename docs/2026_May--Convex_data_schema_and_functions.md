<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# create the Convex data schema + function breakdown. I prefer grouping related tables with the same short preface name so that it becomes easier to understand as the list of tables gets longer.

I created both the **Convex schema** and a **function breakdown document**, and grouped the tables with short shared prefixes exactly the way you asked. The schema uses grouped names like `sim_`, `usr_`, `gal_`, `emp_`, `flt_`, `eco_`, and `trd_`, which keeps the table list readable as the project grows.[^1][^2]

## What’s included

The schema defines typed Convex tables using `defineSchema` and `defineTable`, which is the standard Convex pattern for runtime validation and end-to-end TypeScript safety.[^1][^3][^4] The function breakdown also separates **queries**, **mutations**, and **internal turn-resolution functions** in a way that fits Convex’s intended split between reactive reads, transactional writes, and backend orchestration.[^5][^6][^7]

## Why this structure works

Grouping by domain prefix is a good fit here because StarStrat has several overlapping subsystems and the table list will get long fast. With this layout, someone scanning the schema can immediately tell whether a table belongs to simulation flow, galaxy state, empires, fleets, economy, or traders without reading every field name.[^2][^8]

## Recommended next step

The best follow-up is to generate the actual **Convex function stubs** next: `schema.ts` is now there, and the logical next layer is to create the initial `queries.ts`, `mutations.ts`, and `internal.ts` files for each prefix group so the backend skeleton matches the design.[^5][^6]
<span style="display:none">[^10][^11][^12][^13][^14][^15][^9]</span>

<div align="center">⁂</div>

[^1]: https://docs.convex.dev/database/schemas

[^2]: https://docs.convex.dev/understanding/best-practices/

[^3]: https://docs.convex.dev/database

[^4]: https://mintlify.wiki/get-convex/convex-backend/api/server/schema

[^5]: https://contextqmd.com/libraries/convex-backend/versions/latest/pages/npm-packages/private-demos/actions/convex/README

[^6]: https://github.com/Personabo-Technologies/Convex-Docs/blob/main/functions.md

[^7]: https://www.youtube.com/watch?v=dyEWQ9s2ji4

[^8]: https://community.glideapps.com/t/good-table-naming-conventions/41259

[^9]: https://github.com/get-convex/convex-ai-chat-langchain/blob/main/convex/schema.ts

[^10]: https://app.unpkg.com/convex@1.13.2/files/src/server/schema.ts

[^11]: https://www.cursorrules.org/zh/article/convex-cursorrules-prompt-file

[^12]: https://agentskills.me/skill/convex-best-practices

[^13]: https://github.com/get-convex/convex-js/blob/main/src/server/schema.ts

[^14]: https://www.youtube.com/watch?v=0bn9RcwOwOQ

[^15]: https://mintlify.wiki/get-convex/convex-backend/concepts/schemas

