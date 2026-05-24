---
name: shared-component-design-mindset
description: Framework-agnostic guidance for designing reusable shared components with clear ownership, stable APIs, composability, and lifecycle safety. Use when creating or refactoring any shared UI unit in any project.
---

# Shared Component Design Mindset

## Purpose

Define a universal design approach for shared UI units so they remain reusable, predictable, and low-coupling across projects.

## When To Use

Use this skill when creating or refactoring:

- shared components
- shared UI services/wrappers
- reusable behavior hooks used by multiple features

## Shared Unit Definition

A shared unit should solve a **generic capability problem**, not a single feature's business workflow.

Good shared units usually provide:

- reusable behavior primitives
- composition-friendly APIs
- stable contracts for multiple consumers

## Non-Shared Signals

A unit is likely **not** truly shared if it:

- depends on one domain model or one product flow
- imports feature-specific modules heavily
- exists mainly for one screen/use case
- encodes business rules instead of generic behavior

## Design Principles

1. **Single capability ownership**  
   One clear responsibility per unit.
2. **Low domain coupling**  
   Keep business logic outside; expose extension points instead.
3. **Composable API first**  
   Prefer slots/render callbacks/config hooks over hardcoded branches.
4. **Minimal public surface**  
   Expose only stable, necessary inputs/outputs.
5. **Explicit state ownership**  
   Internal state for internal behavior only; external state flows through inputs/events.
6. **Lifecycle symmetry**  
   Every setup must have matching cleanup.
7. **Predictable behavior under change**  
   Avoid assumptions tied to index/order/timing that break easily.

## Recommended API Shape

- Declarative inputs (props/config)
- Event outputs (callbacks)
- Optional imperative API only when required by parent orchestration
- Safe defaults for optional behavior

## Lifecycle And Safety Checklist

- event listeners: add/remove symmetry
- timers/animation frames/observers: create/dispose symmetry
- async tasks: cancellation or stale-result guard
- transition/visibility state: explicit synchronization, no hidden race reliance

## Dependency Boundary Checklist

Before accepting dependencies, ask:

1. Is this dependency domain-neutral?
2. Can this be injected from caller instead of imported directly?
3. Will this dependency prevent reuse in another feature/product?

If dependency coupling grows, split core capability from domain adapter.

## Decision Flow

Before adding new logic:

1. Is the new behavior still inside this unit's core capability?
2. Is it reusable across multiple contexts?
3. Can it be expressed as configuration/extension instead of feature branch logic?
4. Would adding it make this unit domain-specific?

If answers indicate ownership drift, stop expanding and split responsibilities.

## Output Expectation

When applying this skill, provide:

- shared-vs-domain ownership decision
- chosen API shape and extension points
- lifecycle safety notes
- reasons why the design stays reusable
