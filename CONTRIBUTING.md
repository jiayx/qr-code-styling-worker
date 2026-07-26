# Contributing

Install Node.js 20.19+ and pnpm, then run:

```sh
pnpm install
pnpm check
```

Changes to adapters should include a test that runs in the workerd-backed
Vitest pool. Keep `qr-code-styling` pinned so upstream compatibility changes
are deliberate and reviewable.
