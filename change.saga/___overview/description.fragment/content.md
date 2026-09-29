# Product intent {#product-intent}

Cordyceps turns the mock-provider approach explored in DevSwarm into a reusable testing library. A developer selects an AI harness, and the library configures it to communicate with a mock of its model provider API. The actual harness binary participates in the test; prescribed provider responses let the developer exercise behavior in the application that consumes it.

The primary audience is developers building tools around AI harnesses. Their goal is confidence that those tools install and integrate the harnesses correctly and respond as expected to controlled harness behavior. Claude Code communicating with a mock Anthropic API is the motivating example. Expanding the approach to other harnesses and providers is part of the product intent; the initial support list is undecided.

# Real process testing {#real-process-testing}

The consumer can exercise an installed harness binary in interactive and non-interactive modes with the flags relevant to its application. The library automatically configures the selected supported harness to call the mock provider backend. An API lets the consumer inspect the input sent to the binary, inspect the requests that the binary sends to the mock provider, and choose the responses returned by the mock provider.

Process input and provider requests are separate observations. Their representation and correlation are design questions; the documentation does not assume a one-to-one mapping. The binary remains responsible for processing the provider response and producing its normal process output.

# Representative frontend scenario {#representative-frontend-scenario}

A developer builds a frontend around a Claude Code process. After arranging installation, the developer launches the real binary on the target operating system, with the relevant mode and flags. The frontend writes input to that process. The test can inspect that input and the resulting mock-provider requests, prescribe a text or tool-call response, and check the frontend's handling of the binary's actual output.

This flow exercises the actual operating-system integration, including the permissions and environment loading encountered by that process. A passing scenario proves the exercised path works in that environment; it does not claim coverage of every permission, environment configuration, or operating system. Cordyceps supplies the controlled provider behavior and observations; assertions about frontend rendering belong to the consuming application's test.

# Tool calls execute in the real harness {#real-tool-execution}

The mock backend supplies a provider response containing valid tool-call semantics for the selected harness, including the tool name and arguments. The binary handles and executes that call as it normally would, using its real tools, operating-system access, and permission behavior. Cordyceps controls the provider response; it does not substitute the execution of the requested tool or manufacture its result.

For example, a test supplies a real fixture file and prescribes a file-read tool call for that path. When the harness permissions allow the operation, the binary reads the actual file. The consuming test can then inspect the resulting provider traffic and frontend behavior. If permission handling intervenes, that is part of the real harness behavior the test exercises.

This boundary was explicitly confirmed by the user: the binary should execute the tool call as it normally would, while the backend supplies tool-call semantics that can force an operation such as a file read.

# Playwright E2E workflow {#playwright-e2e-workflow}

The user expects to consume Cordyceps from Playwright tests with familiar browser-like setup, interception, and mocking. A test wires the selected real harness to the mock provider, drives the application, inspects incoming provider requests, and supplies the responses needed to exercise the frontend. This expected workflow is recorded as an accepted product requirement; exact API names and package boundaries remain undecided.

The intended interception point is the mock provider backend receiving traffic from the real harness process. Playwright drives the frontend and its assertions. Both activities must be usable in the same test so a frontend action can lead to a provider request, a controlled response, actual binary output, and a rendering assertion. Tool-call responses retain the confirmed real-execution behavior.

## Proposed fixture ergonomics {#proposed-fixture-ergonomics}

The following are agent-proposed design implications of the browser-fixture analogy, pending review:

- A fixture supplies a test-scoped control object and prepares the mock-provider connection before the application launches its harness.
- Tests register request matchers and handlers that can inspect a request and fulfill it with a chosen provider response.
- Tests can await a matching request or other observation, with bounded waits and useful timeout diagnostics, so synchronization does not depend on fixed sleeps.
- Fixture teardown releases library-owned resources and pending handlers even when a test fails. Ownership of application-launched processes must be explicit.
- Separate tests and parallel workers have isolated request histories, response rules, and mock-provider configuration.

Matcher syntax, handler ordering, streaming controls, unmatched-request behavior, and failure injection are open design questions. Familiar E2E ergonomics do not yet specify an exact copy of the Playwright browser API. No fixture or API described here has been implemented.

# Programmatic use outside Playwright {#standalone-programmatic-use}

The user also requires a programmatic way to wire a real AI harness to Cordyceps outside Playwright. Consumers can use it for focused experiments, custom tests, and their own mocking frameworks. Playwright is an integration option; the setup, observation, interception, and response-control capabilities must remain usable without its test runner or fixture lifecycle.

Standalone consumers can inspect process input and provider requests and prescribe text or tool-call responses through the library API. The consumer still installs the binary, and the binary still processes responses and executes tools normally on the underlying OS. This use case serves the existing developer persona and does not depend on expanding the audience to developers creating new harnesses.

A reusable core API with a Playwright fixture adapter is a proposed design direction for satisfying both workflows. Exact package structure, lifecycle methods, and ownership of launched processes remain design decisions. These are intended capabilities; no standalone API has been implemented yet.

# Scope still to resolve {#scope-still-to-resolve}

The user also sees a possible use for developers building a new harness directly against a mocked provider API. This is a candidate future audience, not a committed first-release requirement. The first design should make that boundary explicit as it evolves.

The consumer is responsible for installing the binary before testing. Cordyceps helps prove that installation works by exercising the real binary.

The library runtime, exact public API, supported harness/provider versions and operating systems, and process/terminal ownership remain undecided. The API must expose process input and requests received by the mock provider and let the consumer force a response; how it captures and presents those observations remains a design question. Text exchanges and provider-side tool calls are required scenario capabilities. Tool calls execute through the real binary using its normal tool implementation and permission behavior. The additional provider features to support remain open.

# Evidence and maturity {#evidence-and-maturity}

This repository has no product implementation yet. The user confirmed the initial six-story requirements baseline for committing before the next design step. These documents describe intended behavior, not delivered or verified capabilities. Accepted stories record user-confirmed requirements, not completed work; proposed stories remain drafts for discussion; there are no implementation or test-result claims for Cordyceps.

The earlier DevSwarm work is precedent, not implementation evidence for this repository. DayLight Local session `66c622ec-f2fd-4763-a2c8-1f19bc89d3ff`, source-record branch `spike/tart-macos-vm-ai-e2e`, describes real Claude Code talking to a scripted Anthropic API, executing tools, and recording requests. Selected evidence was authored on 2026-09-19; the session runs through 2026-09-21. Its DevSwarm repository association is workspace-derived. Relevant document identifiers: `document-f9030ea8c0039611252ab5d0c255f160a96c9bf5fc14660de751e151be9b503f` and `document-914a0b7832e9896b564a9b506a376d8a605ed6b5d4c26833a1b5943c871ae6f0`. Team evidence was unavailable for this folder.

# Confirmed audience {#confirmed-audience}

In the current product discussion, the user stated: “for now it's developers building tools around AI harnesses,” and described direct harness development against a mocked provider API as a possible additional use case.
