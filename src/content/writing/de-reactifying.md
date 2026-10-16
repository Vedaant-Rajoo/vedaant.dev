---
title: "De-Reactifying Your Project"
summary: "What it means to remove React from the parts of your app that don't need it"
published: "2026-08-05"
kind: post
draft: false
---

In October 2017, the Netflix UI engineering account tweeted that removing client-side React from the logged-out landing page, while keeping it on the server, produced a [50% performance improvement](https://x.com/NetflixUIE/status/923374215041912833). The follow-up in the same thread mattered just as much and got quoted far less: *"And yes, we still ❤️ React and pre-fetch it to use on subsequent steps."*

Those two tweets are this post in miniature. Netflix took React out of one place where it wasn't earning its cost, kept it everywhere it was, and measured the result. Chrome's Addy Osmani later wrote up [the case study](https://medium.com/dev-channel/a-netflix-web-performance-case-study-c0bcde26a9d9). React itself accounted for only about 45 kB on that page, but removing it along with the libraries and app code that came with it cut more than 200 kB of JavaScript and improved Time-to-Interactive by more than 50%. Sign-up clicks went up measurably as a result.

There's no widely agreed name for this practice, so let's give it one: **de-reactifying**, the deliberate and usually partial removal of React from the parts of a project where it costs more than it's worth. It's an audit, and you don't have to rewrite your app or pick a side in the framework wars to do it.

Two stories explain why this is worth talking about in 2026: how React earned its position, and what that position costs now.

## How React got everywhere

It's easy to forget that when React was open-sourced at JSConf US in [May 2013](https://blog.risingstack.com/the-history-of-react-js-on-a-timeline/), the room largely hated it. Jordan Walke had built the prototype (an internal project called FaxJS, inspired by Facebook's XHP) around 2011, and when Tom Occhino and Walke presented it publicly, [the audience was skeptical, and many thought it was a step backward](https://blog.risingstack.com/the-history-of-react-js-on-a-timeline/). JSX, which put HTML-like markup inside JavaScript, was seen as [a violation of "separation of concerns," which had been gospel for years](https://www.articsledge.com/post/reactjs).

React won that argument on merit. Pete Hunt's "Rethinking Best Practices" talk reframed separation of concerns as separation of *technologies* and argued that components were the real unit of concern. David Nolen's Om, built on React for ClojureScript, [demonstrated in late 2013 that React could outperform the alternatives of the day](https://blog.risingstack.com/the-history-of-react-js-on-a-timeline/), which won over the very crowd that had been most dismissive. The virtual DOM gave developers a declarative model: you describe the UI, and the library reconciles the changes. At the time, the alternatives were hand-managed jQuery mutation soup or two-way binding frameworks that got tangled at scale.

The milestones from there:

- 2015: React Native extends the component model to mobile.
- 2016: Create React App ships, [removing the webpack/Babel configuration wall](https://dev.to/satyaveer_jaligama/the-deprecation-of-create-react-app-1mh4) and making React the easiest big framework to start with.
- 2017: React 16 lands the Fiber rewrite. The same year, React survives its first real governance crisis: the BSD+Patents license scared enterprises enough that [WordPress dropped React over legal concerns](https://dev.to/homayounmmdy/the-rise-of-react-from-outrage-to-dominance-1knk), and Facebook relicensed React under MIT to end it.
- February 2019: React 16.8, [officially "The One With Hooks"](https://react.dev/versions), replaces class components as the default way to write React and reshapes how the industry thinks about UI state.
- March 2022: [React 18](https://react.dev/versions) makes concurrent rendering public, with transitions, automatic batching, and streaming SSR with Suspense.

Along the way, React's ideas (components, one-way data flow, declarative rendering, hooks-style composition) stopped being React features and became industry assumptions. Vue, Svelte, Solid, Qwik, and Preact all exist in a design space React defined. If you're thinking about moving away from React, it's worth admitting up front that most of the places you'd move to are standing on its shoulders.

## React since 2020

The second story starts in December 2020, when the React team published a holiday research update on ["zero-bundle-size React Server Components"](https://x.com/reactjs). Server Components were an attempt to solve a problem React's own success had created: the ever-growing pile of JavaScript shipped to the client.

The years since have been React's most ambitious and its most contested. On the ambitious side, [React 19 shipped on December 5, 2024](https://react.dev/blog) with Server Components and Actions as stable features. The [React Compiler](https://react.dev/blog) reached beta in October 2024 and automates the memoization work (`useMemo`, `useCallback`, `React.memo`) that developers had been doing by hand for years. In February 2026, [the React Foundation launched under the Linux Foundation](https://react.dev/blog) and moved governance out of Meta, arguably the biggest structural change in the project's history.

The friction is just as well documented, and complexity became the headline complaint. In the [State of JS 2024 survey](https://2024.stateofjs.com/en-US/libraries/), React was the second most used library and the second most loved, which is remarkable staying power for a project more than a decade old. But in the same survey's write-in section, React was [the most criticized tool, with 14% of respondents reporting issues and citing excessive complexity, performance, choice overload, and breaking changes](https://javascript-conference.com/blog/state-of-javascript-ecosystem-2024/). The 2024 State of Frontend report recorded [the first decline in React's "used and like it" figure, from 76.2% in 2022 to 69.9%](https://tsh.io/blog/javascript-frameworks-frontend-development).

Server Components split the community. The client/server boundary and the `use client` directive introduced a mental model that many developers found [harder to reason about as applications grow](https://mayank.co/blog/react-server-components/), and library maintainers [publicly documented the burden of supporting both worlds](https://medium.com/@junior-felix/the-discourse-around-react-server-components-3b8f942410d3). Much of the practical RSC documentation lived in the Next.js docs rather than React's, which fed [an ongoing debate about Vercel's influence on React's direction](https://frontendfm.substack.com/p/the-state-of-react-community-in-2025). The React team has worked to address that perception.

Next.js, React's flagship framework, sits near the bottom of its category for satisfaction. State of JS 2024 put it bluntly: Next.js leads in raw usage, but [in retention, "if not for Gatsby, Next.js would be dead last"](https://2024.stateofjs.com/en-US/libraries/meta-frameworks/). Astro and SvelteKit keep their users notably happier.

The tooling story fractured too. On [February 14, 2025, the React team formally deprecated Create React App](https://react.dev/blog/2025/02/14/sunsetting-create-react-app), which had gone unmaintained for years and was [broken by React 19's dependency requirements](https://devclass.com/2025/02/18/react-team-formally-deprecates-create-react-app-following-perfect-storm-of-incompatibility/). The team pointed new projects at frameworks or at build tools like Vite, Parcel, and Rsbuild. It was a sensible decision, but it ended the era when "how do I start a React app" had a single official answer.

The server-first shift also widened the attack surface. On [December 3, 2025, the React team disclosed an unauthenticated remote code execution vulnerability in React Server Components](https://react.dev/blog), and on December 11 it followed up with [additional denial-of-service and source-code-exposure disclosures](https://react.dev/blog). Every framework has CVEs. These came from React now running meaningful application logic on servers, a place the 2013 library never went.

React isn't failing, but it's big enough now that its costs, like its benefits, show up on every axis at once: bundle bytes, hydration time, conceptual overhead, governance, and security.

## Five ways to de-reactify

De-reactifying covers a range of moves, and all of them have shipped in production somewhere. Here they are, roughly from least to most invasive.

### 1. Remove client-side React, keep server-side React

This is what Netflix did. The landing page [kept React as a server-side templating layer and dropped the client runtime, hydration, and attendant libraries](https://medium.com/dev-channel/a-netflix-web-performance-case-study-c0bcde26a9d9), while Netflix pre-fetched React for the interactive signup flow that followed. Your component code survives, and on pages that are mostly static, your users stop paying for it.

### 2. Swap the runtime, keep the components

[Preact is about 3 kB gzipped, against roughly 40 to 47 kB for React plus ReactDOM](https://www.pkgpulse.com/blog/htmx-vs-react-2026), and its `preact/compat` layer lets [existing React components run unmodified](https://checkthat.ai/brands/react/alternatives). It's the lowest-effort way to de-reactify: you keep the same JSX and hooks and ship roughly a tenth of the runtime.

### 3. Shrink React to islands

[Astro renders zero JavaScript by default and hydrates only the interactive "islands" you mark](https://arceniktechnologies.com/blogs/top-javascript-frameworks-2026), and those islands can still *be* React components. In State of JS 2024, [Astro posted a 94% "would use it again" rate](https://www.infoworld.com/article/3804318/state-of-javascript-highlights-from-the-latest-javascript-developer-survey.html). This pattern demotes React from "application runtime" to "widget engine," which for content-heavy sites is usually what it should have been.

### 4. Replace React components with platform primitives, incrementally

Microsoft took this route with Edge. The browser's UI (settings, history, the sidebar, and so on) was built in React, and Andrew Ritz, who leads Edge's Fundamentals team, described its performance on low-end devices as ["terrible"](https://dev.to/safdarali/how-microsoft-edge-is-replacing-react-with-web-components-4eml). The team's WebUI 2.0 project is [a markup-first architecture replacing React components with performance-tuned native web components](https://thenewstack.io/from-react-to-html-first-microsoft-edge-debuts-webui-2-0/), rolled out surface by surface, starting with the Browser Essentials panel. By Microsoft's own numbers for Edge 122, [the UI became 42% faster for all users and 76% faster on devices without an SSD or with less than 8 GB of RAM](https://thenewstack.io/from-react-to-html-first-microsoft-edge-debuts-webui-2-0/). The team has said it hopes ["that more websites start moving in this direction of markup-first, small bundles, and less UI-rendering JavaScript code."](https://thenewstack.io/from-react-to-html-first-microsoft-edge-debuts-webui-2-0/)

### 5. Move interactivity back to the server entirely

[htmx is a ~14 kB library that extends HTML with attributes for issuing requests and swapping server-rendered fragments into the DOM](https://devtoolswatch.com/en/htmx-vs-react-2026). You don't need a client router, a client state store, or a build step. It won't replace a collaborative editor, and [each interaction costs a server round-trip](https://dev.to/royce_fabbd83cb268312e928/htmx-vs-react-14kb-vs-200kb-do-you-still-need-a-js-framework-1e1), but for CRUD-heavy applications it has become a real option. By 2026 it was [the number-one frontend project in the JavaScript Rising Stars rankings for 2024 and the second most admired web framework in the Stack Overflow Developer Survey](https://devtoolswatch.com/en/htmx-vs-react-2026).

Nobody in these stories was chasing a trend. Netflix measured Time-to-Interactive, and Microsoft [analyzed telemetry from real users' machines](https://www.notebookcheck.net/Microsoft-tackles-poor-Edge-browser-user-interface-performance-by-replacing-React-UI-with-WebUI-2-0.842391.0.html). If you de-reactify anything, start the same way, with a measurement.

## The alternatives in 2026

If your audit points toward a bigger change, the alternatives have come a long way from the graveyard of half-finished frameworks this space once was. The State of JS data shows a settled field of options with distinct personalities:

- Vue is the second most used frontend framework. It [overtook Angular and has held that position](https://2024.stateofjs.com/en-US/libraries/front-end-frameworks/), and it has an incremental-adoption story that React itself lacks.
- Svelte uses a compiler-first model with a minimal runtime. Svelte 5 introduced [runes (`$state`, `$derived`, `$effect`), explicit reactive primitives with deep reactivity](https://naturaily.com/blog/why-svelte-is-next-big-thing-javascript-development), and the framework [continues to top the State of JS rankings for overall positive opinion](https://2024.stateofjs.com/en-US/libraries/front-end-frameworks/). SvelteKit has [a 90% would-use-again rate](https://www.infoworld.com/article/3804318/state-of-javascript-highlights-from-the-latest-javascript-developer-survey.html).
- SolidJS has [React-like JSX, fine-grained signal reactivity, and no virtual DOM](https://arceniktechnologies.com/blogs/top-javascript-frameworks-2026). Updates are surgical rather than diffed, which is why it [consistently outperforms virtual-DOM reconciliation in community benchmarks](https://www.pkgpulse.com/guides/solidjs-vs-svelte-5-vs-react-reactivity-2026). Signals proved influential enough that [there is now a TC39 proposal to standardize them in JavaScript itself](https://sandeepkumarchaudhary.com/blog/astro-islands-vs-react-server-components-a-practical).
- Qwik, created by Angular's original author, is built around [resumability: instead of re-executing (hydrating) the app on the client, it resumes from serialized server state](https://arceniktechnologies.com/blogs/top-javascript-frameworks-2026). It ships [on the order of 1 kB of initial JavaScript regardless of app size](https://checkthat.ai/brands/react/alternatives).
- Astro is the islands architecture described above: framework-agnostic, with zero JS by default.
- Web components (Lit, Stencil) are the platform-native option Edge bet on, and State of JS 2024 notes they're [overwhelmingly used by large companies](https://2024.stateofjs.com/en-US/libraries/front-end-frameworks/).
- htmx is the hypermedia-driven outlier, for teams whose backend can be the source of truth.

React's own answer to its critics belongs on this list too. [The React Compiler narrows the performance gap for typical applications without changing the programming model](https://www.pkgpulse.com/guides/solidjs-vs-svelte-5-vs-react-reactivity-2026), and Server Components, for all the debate around them, exist precisely to ship less JavaScript. Staying on React and adopting its newer tools is a legitimate response to the problems this post describes.

## When you shouldn't de-reactify

The other side has data behind it too:

- React remains [one of only three libraries in State of JS 2024 with both over 50% usage and over 50% retention](https://2024.stateofjs.com/en-US/libraries/). The other two are Jest and Vite.
- Its ecosystem, hiring pool, and documentation depth are without peer. [Even Microsoft, while removing React from Edge, continues using React across Windows, macOS, and Xbox surfaces](https://medium.com/@ledraa/why-microsoft-stopped-using-react-b022eccf8ed8).
- Highly interactive, stateful, client-heavy applications (editors, dashboards, anything approximating desktop software in a tab) are [exactly the workload React's model was built for, and React still handles them better than server-driven approaches](https://techloghub.com/compare/htmx-vs-react).
- Netflix's team was explicit that the React components shared across the signup flow [carried real business logic they had no interest in duplicating](https://steemit.com/steemdev/@lightproject/netflix-addressing-reactjs-snobbery-removing-client-side-react-js-improved-performance-by-50). That's why they de-reactified one page and kept React in the rest of the product.

If your app is genuinely app-shaped, de-reactifying may cost you more in rewrites and hiring than it saves in kilobytes.

## Deciding page by page

The framework debate aside, this is an old engineering question: *is this dependency earning its cost on this page, for these users?*

For a decade, the industry's default answer was "yes, obviously, it's React." The Netflix numbers, the Edge telemetry, the State of JS trend lines, and the rise of islands, signals, and hypermedia show only that the answer is no longer automatic. Sometimes it's still yes. Sometimes it's "yes on the dashboard, no on the landing page," or "yes, but as 3 kB of Preact." And sometimes, once you've measured, it's no.

React changed how the industry builds for the web. It survived a hostile debut, a license crisis, and three architectural reinventions, and it just graduated to foundation governance. It doesn't need defending, and it doesn't need to be on every page.

---

## Sources

- Netflix UI Engineering, [landing page announcement (2017)](https://x.com/NetflixUIE/status/923374215041912833) · Addy Osmani, [A Netflix Web Performance Case Study](https://medium.com/dev-channel/a-netflix-web-performance-case-study-c0bcde26a9d9) · Jake Archibald, [Netflix functions without client-side React](https://jakearchibald.com/2017/netflix-and-react/)
- The New Stack, [From React to HTML-First: Microsoft Edge Debuts WebUI 2.0](https://thenewstack.io/from-react-to-html-first-microsoft-edge-debuts-webui-2-0/) · The New Stack, [How Microsoft Edge Is Replacing React With Web Components](https://thenewstack.io/how-microsoft-edge-is-replacing-react-with-web-components/) · Notebookcheck, [Edge WebUI 2.0 telemetry](https://www.notebookcheck.net/Microsoft-tackles-poor-Edge-browser-user-interface-performance-by-replacing-React-UI-with-WebUI-2-0.842391.0.html)
- RisingStack, [The History of React.js on a Timeline](https://blog.risingstack.com/the-history-of-react-js-on-a-timeline/) · React, [Versions](https://react.dev/versions) · React, [v19, Compiler, RSC security disclosures, React Foundation](https://react.dev/blog) · React, [Sunsetting Create React App](https://react.dev/blog/2025/02/14/sunsetting-create-react-app) · DevClass, [CRA deprecation coverage](https://devclass.com/2025/02/18/react-team-formally-deprecates-create-react-app-following-perfect-storm-of-incompatibility/)
- State of JS 2024, [Libraries](https://2024.stateofjs.com/en-US/libraries/) · State of JS 2024, [Front-end Frameworks](https://2024.stateofjs.com/en-US/libraries/front-end-frameworks/) · State of JS 2024, [Meta-Frameworks](https://2024.stateofjs.com/en-US/libraries/meta-frameworks/) · InfoWorld, [State of JavaScript highlights](https://www.infoworld.com/article/3804318/state-of-javascript-highlights-from-the-latest-javascript-developer-survey.html) · JS Conference, [State of the JavaScript Ecosystem 2024](https://javascript-conference.com/blog/state-of-javascript-ecosystem-2024/) · TSH, [State of Frontend / framework trends](https://tsh.io/blog/javascript-frameworks-frontend-development)
- Mayank, [React Server Components: the Good, the Bad, and the Ugly](https://mayank.co/blog/react-server-components/) · Junior Felix, [The Discourse Around React Server Components](https://medium.com/@junior-felix/the-discourse-around-react-server-components-3b8f942410d3) · Frontend FM, [The State of the React Community in 2025](https://frontendfm.substack.com/p/the-state-of-react-community-in-2025)
- DevToolsWatch, [HTMX vs React 2026](https://devtoolswatch.com/en/htmx-vs-react-2026) · PkgPulse, [htmx vs React](https://www.pkgpulse.com/blog/htmx-vs-react-2026) · PkgPulse, [SolidJS vs Svelte 5 vs React reactivity](https://www.pkgpulse.com/guides/solidjs-vs-svelte-5-vs-react-reactivity-2026) · Naturaily, [Svelte 5 & SvelteKit guide](https://naturaily.com/blog/why-svelte-is-next-big-thing-javascript-development) · Arcenik, [Top JavaScript Frameworks 2026](https://arceniktechnologies.com/blogs/top-javascript-frameworks-2026)
