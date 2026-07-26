# Kimi ACP error propagation

Carrent renders run failures as first-class error cards (client side, in
progress). One class of failures cannot be fixed client-side: Kimi Code's ACP
adapter resolves **failed** turns with `stopReason: "end_turn"`, dropping the
error payload, so provider errors (e.g. 403 quota exhausted) never reach any
ACP client.

The upstream report lives in
`issues/01-failed-turns-masked-as-end-turn.md` and is meant to be submitted to
the Kimi Code CLI team.
