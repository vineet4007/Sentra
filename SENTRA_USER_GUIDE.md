# Sentra User Guide

This guide is for someone using Sentra for the first time from the frontend.

If you just want the shortest starting point:

1. Open `http://localhost:3000`
2. Use the **Onboard a project** form
3. Keep the default telemetry URLs if you are using the bundled local Docker stack
4. Add a `revision` if you want Sentra to create a rollout immediately
5. Watch the **Rollout board**
6. Click a rollout card to open its detail page

## What Sentra does

Sentra is a rollout control room.

You connect:

- your project
- your service
- your environment
- your rollout policy
- your telemetry sources such as Prometheus, Loki, and Tempo

Then Sentra:

- watches the rollout
- checks the live telemetry against your thresholds
- decides whether to keep going, pause, or roll back
- shows the decision, reason, incidents, and history in one place

Sentra does not replace Prometheus, Loki, Tempo, Kubernetes, or cloud platforms. It sits on top of them and turns them into one decision surface.

## Where to start in the frontend

Open [http://localhost:3000](http://localhost:3000).

This page is the **control room**. It is the main landing page for operators.

From this page you can:

- onboard a new project
- see live rollout cards
- watch the live event stream
- review AI advisory panels
- review benchmark readiness
- inspect satellites
- click any project card to open its dedicated workspace at `/projects/:id`

Current product note:

- the homepage form creates the first service inside a project
- the homepage now also includes **Add another service** for existing projects
- the homepage project cards now open a dedicated project workspace
- the project workspace lets you manage services and environment integrations without leaving the frontend
- the same capability is also available through the API route `POST /projects/:id/services`
- the control room understands those extra services once they exist and shows them on the rollout board like any other service

Important current behavior:

- the onboarding form currently creates a **Kubernetes-style rollout in `simulation` mode**
- that means it is safe for first-time exploration
- Sentra will evaluate and simulate rollout actions without mutating a real cluster unless you explicitly configure direct apply elsewhere

## First-time setup from the UI

Use the **Onboard a project** panel on the homepage.

### Recommended first run

For a first test, fill:

- `Project`: a project name
- `Service`: your app or workload name
- `Environment`: usually `staging`
- `Namespace`: your Kubernetes namespace or a logical namespace name
- `Deployment target`: the workload/deployment name
- `Revision`: a release identifier such as `v1.2.3`, a Git SHA, or an image tag

If you leave `Revision` blank:

- Sentra will connect the project and policy
- but it will not create a rollout yet

If you provide `Revision`:

- Sentra will create a deployment immediately
- and you will start seeing rollout activity on the board

### Telemetry setup

The form also asks for:

- `Prometheus URL`
- `Loki URL`
- `Tempo URL`

If you are using the bundled local Docker setup, the defaults are correct:

- `http://prometheus:9090`
- `http://loki:3100`
- `http://tempo:3200`

If your telemetry lives elsewhere, use URLs that are reachable from the Sentra containers, not just from your browser.

### Rollout policy setup

The form also lets you define:

- `Stable fallback floor (%)`
- `Rollout steps`
- `Error rate max`
- `Latency max`
- `Required passes`
- `Warmup sec`

Recommended first values:

- Stable fallback floor: `5`
- Rollout steps: `5,25,50,95`
- Error rate max: `2`
- Latency max: `500`
- Required passes: `3`
- Warmup sec: `30`

These mean:

- keep at least 5% of traffic on the last healthy stable path while the candidate is still being proven
- start with 5% of traffic
- then 25%
- then 50%
- then 95%
- only promote when the rollout passes the checks enough times
- wait a little after each shift so metrics can settle

## What each onboarding field means

| Field | What it means | How to think about it |
| --- | --- | --- |
| `Project` | The product or application group | Example: `checkout-platform` |
| `Repository URL` | Optional code repository link | Useful for traceability |
| `Service` | The deployable app/workload | Example: `payments-api` |
| `Environment` | Where this rollout is happening | Example: `staging`, `production` |
| `Namespace` | Logical or Kubernetes namespace | Helps target the workload |
| `Deployment target` | The actual workload name | Example: deployment/service name |
| `Stable fallback floor (%)` | Minimum stable traffic kept during rollout evaluation | Example: `5` means keep at least 5% on stable until the rollout is complete |
| `Prometheus URL` | Metrics source | Used for SLO checks |
| `Loki URL` | Logs source | Used for error and incident context |
| `Tempo URL` | Trace source | Used for trace visibility and latency context |
| `Rollout steps` | Traffic percentages Sentra will walk through | Example: `5,25,50,95` |
| `Error rate max` | Max allowed error rate | Higher than this becomes risky |
| `Latency max` | Max allowed P95 latency in ms | Higher than this becomes risky |
| `Required passes` | How many healthy evaluations are needed | Prevents noisy one-off promotions |
| `Warmup sec` | Wait time after a traffic shift | Lets telemetry stabilize |
| `Revision` | The candidate release identifier | Example: image tag, SHA, or version |
| `Image ref` | Optional image reference | Helps with auditability |

## How to read the homepage after onboarding

### 1. Hero area

This is the high-level control-room summary.

It tells you:

- how many projects are connected
- how many rollouts are visible
- how many delegated executions exist
- how many rollouts currently look risky

### 2. Live control pulse

This is the live event stream.

It shows:

- rollout decisions
- satellite task events
- refresh activity from the control plane

If it says `SSE connected`, the browser is receiving live server-sent events.

If it says `Offline`, refresh the page or check that the API is reachable.

### 3. Rollout board

This is the main operational view.

Each rollout card shows:

- service name
- environment
- current traffic weight
- revision
- incident count
- rollout step progression
- latest controller note
- AI advisory summary
- telemetry gate chips

Click any rollout card to open the detailed rollout view.

### 3.5. Project workspace

Click any project card on the homepage to open `/projects/:id`.

This page is the project-level management view.

Use it when you want to:

- see every service inside one project
- review the environments connected to that project
- add another service without creating a new project
- update environment telemetry and integration settings in one place

Think of the homepage as the cross-project control room and the project workspace as the focused management page for one project.

### 4. AI benchmark and evaluation panels

These panels help you understand the AI layer, but they do not control the rollout.

Use them to answer:

- Is the AI getting better?
- Is the candidate model safer or noisier?
- Is there enough data to trust the benchmark?

### 5. Federation panel

This shows satellites and their health.

If you have multiple regions or remote execution points, this panel tells you:

- which satellites are online
- which can execute delegated tasks
- which are stale

## How to read a rollout card

Each rollout card gives a quick answer to: “What is happening right now?”

Look at these parts first:

- `Current traffic`
- `Revision`
- top-right status pill
- telemetry gate chips
- latest controller note

### Status words on rollout cards

| Status | Meaning |
| --- | --- |
| `initialize` | Sentra is starting the rollout and moving into the first traffic step |
| `hold` | Sentra is waiting before the next move, often during warmup or while gathering enough evidence |
| `promote` | Sentra believes the rollout is healthy enough to move to the next traffic step |
| `pause` | Sentra has stopped automatic promotion because something needs attention |
| `rollback` | Sentra believes the release is unsafe and should move traffic away from the candidate |
| `completed` | The rollout reached the final step successfully |
| `running` | The rollout is active but not yet complete |

## How to use the rollout detail page

Click any rollout card to open `/rollouts/:id`.

This page is the best place to understand why Sentra made a decision.

### Sections on the detail page

#### AI advisor

This is an advisory panel.

It shows:

- risk score
- confidence
- recommendation
- anomalies
- rollback probability
- next-step risk

Important:

- AI is advisory-only right now
- the deterministic rollout controller still owns the actual rollout decision

#### Shadow scorecard

This tells you how the AI performed after the fact.

Common values:

| Shadow review status | Meaning |
| --- | --- |
| `matched` | AI warning aligned with the real outcome |
| `early_warning` | AI warned before the issue fully showed up |
| `false_positive` | AI warned, but the rollout turned out okay |
| `false_negative` | AI missed a real problem |
| `pending` | Not enough rollout outcome data yet to judge |
| `informational` | There was advisory data, but not a strong pass/fail conclusion |

#### Rollout shape

This shows:

- current traffic percentage
- stable fallback percentage
- rollout steps
- overall rollout status
- start time
- telemetry window

#### Gate readout

This is the most important debugging section for rollout health.

Each gate shows:

- the gate name
- the latest value
- whether the signal is okay, missing, or failing
- the reason
- the query used

If a rollout is not moving, this section usually tells you why.

#### Audit history

This is the action log.

It answers:

- what Sentra did
- when it did it
- and why

#### Federated execution

This shows delegated work done by satellites for this rollout.

If your rollout is executed through a remote satellite, you will see:

- queued
- claimed
- completed
- failed

#### Incidents

This is where you see rollback reasons and risk summaries tied to the rollout.

#### Current action

This shows the most recent action the controller took or attempted.

It includes:

- adapter
- mode
- traffic shift

Example:

- `Adapter: kubernetes`
- `Mode: simulation`
- `Traffic shift: 25% -> 50%`

## How to use satellites

### What a satellite is

A **satellite** is a regional or remote Sentra worker.

We use the word **satellite** because it orbits the main coordinator:

- the **coordinator** is the central Sentra control plane
- the **satellite** is a remote execution point closer to a cluster, region, or cloud target

This helps when:

- your targets live in different regions
- you want execution closer to the environment
- you do not want every action to originate from one central node

### What “federated control” means

It means Sentra can decide centrally but execute through remote workers.

### When to use “Queue delegated reconcile”

Use **Queue delegated reconcile** on the rollout detail page when:

- a live satellite task worker is available
- you want that satellite to perform the next rollout reconcile

What happens next:

1. Sentra queues a `reconcile.deployment` task
2. the selected satellite claims it
3. the satellite executes the rollout reconcile
4. the result appears in the rollout and satellite history

If there are no task-worker satellites available, you can ignore this section.

## How to monitor easily as a first-time user

If you are new to Sentra, use this order every time:

1. Start on the homepage
2. Look at the top-right status on each rollout card
3. Open the rollout card that is paused, rolled back, or looks risky
4. Read the **Gate readout**
5. Read **Audit history**
6. Check **Incidents**
7. Use **Current action** to see the last traffic movement
8. Use the AI panels only as extra context, not as the source of truth

If you only remember one rule:

**Gate readout plus audit history tells you the real operational story.**

## Glossary and why Sentra uses these words

### Canary

A **canary** rollout means only a small percentage of users gets the new version first.

Why we use this word:

- it is a common deployment term
- it means “test the new release on a smaller audience before full promotion”

### Current traffic

This is the percentage of live traffic currently routed to the candidate release.

Example:

- `5%` means 5% of traffic is on the new revision
- `100%` means the rollout is fully promoted

### Stable fallback

This is the percentage of live traffic still reserved for the last healthy version while the rollout is in progress.

Why we use this phrase:

- it makes the safety posture visible
- it reminds operators that the candidate should not consume all traffic before it is trusted

### Promote

**Promote** means move forward to the next rollout step.

Example:

- from `5%` to `25%`
- from `25%` to `50%`

### Pause

**Pause** means stop automatic movement and wait.

We use this when:

- data is concerning
- a check is failing
- or a human should look before moving on

### Rollback

**Rollback** means stop trusting the candidate and move traffic away from it.

We use this word because it is the clearest term for “undo this release movement now.”

### Hold

**Hold** means “not promoting yet, but not rolling back either.”

This usually happens during:

- warmup time
- evidence gathering
- waiting for enough healthy passes

### Revision

A **revision** is the specific release being evaluated.

It can be:

- a version number
- a Git SHA
- a container tag
- a cloud revision name

### Candidate

The **candidate** is the new revision trying to earn more traffic.

Why we use this word:

- it means “the release currently being tested”

### Stable

The **stable** version is the currently trusted version that serves as the safe fallback.

### Gate

A **gate** is a health check Sentra uses before promoting.

Examples:

- error rate
- latency
- telemetry availability

Why we use this word:

- the rollout has to pass through the gate before moving forward

### Error rate

This is the percentage of requests that are failing.

Higher error rate usually means the rollout is unhealthy.

### P95 latency

**P95 latency** means the 95th percentile request latency.

Simple meaning:

- 95% of requests are faster than this number
- 5% are slower

Why we use P95 instead of just average latency:

- averages can hide bad tail behavior
- P95 is a stronger signal for user pain during rollouts

### Warmup

**Warmup** is the wait time after a traffic shift.

Why we use it:

- metrics need time to settle
- rolling out too fast can create false confidence

### Required passes

This means how many healthy evaluations Sentra wants before promotion.

Why we use it:

- one good metric sample is not enough
- repeated healthy samples are safer

### Incident

An **incident** in Sentra is recorded rollout trouble or risk context.

It is not only for major outages. It can also be a rollout-blocking signal.

### Live control pulse

This is the live event stream in the UI.

Why we use this phrase:

- it is the “heartbeat” of current rollout activity

### Satellite

A **satellite** is a remote Sentra worker that can heartbeat, claim tasks, and execute delegated reconcile work.

Why we use this word:

- it clearly separates the remote worker from the central coordinator

### Federation

**Federation** means Sentra is operating across multiple execution points instead of one single control node.

### Benchmark readiness

This is the AI model readiness panel.

Why we use this phrase:

- the candidate model should prove itself before it is trusted more

### Candidate ready

This means the current AI benchmark says the candidate advisory model looks good enough for the next review stage.

It does **not** mean Sentra will hand rollout control to AI automatically.

### Brier score

This is a probability-quality metric for AI predictions.

Simple rule:

- lower is better

You can mostly treat it as “how well calibrated the rollback probability is.”

## Common first-time confusion

### “I onboarded a project, but no rollout appeared.”

Most likely:

- you left `Revision` blank

Sentra connected the project, but did not create a deployment.

### “The rollout is stuck on hold.”

Usually this means:

- warmup is still running
- Sentra is waiting for enough passes
- telemetry is not stable enough yet

Open the rollout detail page and read:

- Gate readout
- Audit history

### “I see `no_data`.”

Usually this means:

- telemetry URLs are wrong
- labels do not match the data
- or the monitored service is not emitting the expected telemetry

### “The AI says something scary, but the rollout is still moving.”

That is expected.

Right now:

- AI is advisory-only
- the deterministic controller still owns rollout decisions

### “Why does the UI say simulation?”

Because the current onboarding form is intentionally safe by default.

It creates a rollout in simulation mode so you can validate the flow before enabling direct apply to real infrastructure.

## Recommended first-time workflow

For a first successful Sentra experience:

1. Start with `staging`
2. Keep the default local telemetry URLs
3. Keep the stable fallback floor at `5`
4. Use rollout steps `5,25,50,95`
5. Add a revision so a rollout is created immediately
6. Watch the rollout board
7. Open the rollout detail page
8. Learn the gate readout and audit history first
9. Treat AI and federation panels as extra capability, not your first debugging tool

## Final mental model

If you want the simplest way to think about Sentra:

Sentra is the place where you:

- connect a project
- define how safe rollout should work
- watch live health
- understand decisions
- and act from one control room

The most important screens are:

- homepage for overview
- rollout detail for truth
- satellite detail for delegated execution

The most important words are:

- `promote` means move forward
- `pause` means stop and inspect
- `rollback` means move away from the candidate
- `satellite` means remote execution worker
- `P95 latency` means tail latency, not average latency

If you understand those, you can already use Sentra effectively.
