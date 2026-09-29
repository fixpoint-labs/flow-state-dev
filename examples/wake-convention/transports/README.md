# Transport registry (proposed)

A folder here **is** the registration. Same rule as a `WORKER.md` seat or a
`blocks/*.ts` tool: the file convention registers it; nothing lists it in a
host TypeScript map.

```
transports/<id>/TRANSPORT.md
transports/<id>/events/<event>.md
```

The event catalog is the union of those `events/` files. A worker or channel
folder may **reference** an id from that catalog. It does not re-declare the
transport.

`readTransportRegistry` is proposed. Today a host still writes
`createWebhookTransportAdapter({ providers: { github } })` in code.
