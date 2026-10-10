# @openfilm/shared

What OpenFilm's clients (the desktop app) and the OpenFilm service share: a chat turn and the events a client sees,
how an agent's activity reads, prompt references, title limits, Markdown parsing, and the public API contract.

```ts
import { buildPromptDisplay, type Turn } from '@openfilm/shared';
import { scanMarkdownBlocks } from '@openfilm/shared/markdown';
import { mediaErrorSchema, apiErrorCode } from '@openfilm/shared/api';
```

`@openfilm/shared/api` holds the requests, responses and error codes of `/v1/media/*`, `/v1/agent/*` and
`/api/desktop/*`, written with [zod](https://zod.dev): clients parse with them, and the service's contract tests
check its answers against them. They change only by adding: a field or a code is never renamed or removed.
`@openfilm/shared/api/error-codes` is the list of error codes as plain JavaScript, for code that runs without a
TypeScript step.

Part of [OpenFilm](https://github.com/openfilm/openfilm). MIT licensed.
