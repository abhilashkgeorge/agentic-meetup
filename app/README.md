# Clone — mobile app

Expo, hand-built screens on the Expo Router template's config.

    npm install                    # from the repo root
    npm run build --workspace=@clone/shared   # app imports the built shared package
    npx expo run:ios --device      # dev build; Expo Go cannot load the native modules

## The rule this app obeys

**The phone is never the authority on any user fact.** It owns capture, render,
optimistic UI and the auth token. Every decision about what is true — extraction,
supersession, retrieval, the fact store — happens server-side.

Hold that line and the client stays replaceable. Break it and the profile becomes a
function of which phone the user owns.

## Structure

    src/app/          expo-router screens (index = chat, signin = dev token)
    src/features/     useChat: the WebSocket transport
    src/lib/          env (LAN host resolution), storage (keychain)
    src/store/        zustand session state

## Why WebSocket, not SSE

`expo/fetch` streaming still carries unshipped iOS fixes — empty body on a 200,
dropped chunks, AbortSignal hangs. React Native's WebSocket is built in and stable.

## Turn idempotency

The **client** generates `turnId`. That is what makes a turn safe to resend: a
reconnect on a flaky mobile network can never produce a second LLM call, because the
server keys on `(user_id, turn_id)` and replays the answer it already produced
instead of generating — and charging — twice.

We resume the *turn*, not the token stream. Buffering chunks server-side would
require sticky routing, which is container-per-user through the back door.

## Types come from @clone/shared

`ClientMessage` and `ServerEvent` are imported, not re-declared. A protocol change on
the server breaks this app at compile time rather than at runtime on someone's phone.
That is the whole reason the server is TypeScript.

## Known workaround in here

`autoCorrect={false} spellCheck={false}` on every multiline `TextInput`.
facebook/react-native#57725: on iOS 26.6 + Fabric a controlled multiline input grows
memory unboundedly with autocorrect on, until jetsam kills the app — no crash log, no
simulator repro. That component is the product, so the workaround is not optional.

## Status: W1

Chat over WebSocket with streaming and `turnId` idempotency, keychain-stored token,
reconnect with backoff and heartbeat timeout, and the clone's clarifying question
surfaced from the conflicts queue.

Not built: voice (W5), the profile/soul-file screen (W6), the 3D avatar (spike passed
— `spike/avatar/src/animation.ts` moves in as-is), real auth and the consent surface
(W6).
