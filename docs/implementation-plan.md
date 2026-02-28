# Implementation Plan

This repo bootstraps the Venn-based PM tool with a React + TypeScript frontend and a canvas-first experience. The current build focuses on the Venn canvas, data model, and synced list/detail panel.

## Phase 0: Scaffold (completed)
- React + TypeScript + Vite setup
- Core types for modules, items, and membership
- Geometry utilities to compute membership
- Canvas MVP: draggable modules/items + resize handles
- Side panel: item list + details view

## Phase 1: Canvas MVP
1. Add zoom + pan controls
2. Add module rename + color picker
3. Add item quick edit (title/status/priority) in side panel
4. Membership badges on item chips
5. Module lock toggle and z-index bring-to-front
6. Chip clustering ("+N") when dense

## Phase 2: List + Kanban
1. List view with sortable columns and filters
2. Kanban view by status with drag-and-drop
3. Bidirectional sync across views
4. Persisted local state (temporary localStorage)

## Phase 3: Backend & Auth
1. PostgreSQL schema + Prisma
2. Workspace, project, user models
3. Google OAuth (Auth.js)
4. Item/module CRUD endpoints
5. Membership recompute on save

## Phase 4: Collaboration
1. Comments
2. Activity log
3. Notifications (in-app)

## Phase 5: Scale + Quality
1. Virtualization for lists
2. Canvas spatial index
3. E2E tests (Playwright)

## Immediate Next Tasks
1. Add inline editing in the details card
2. Add membership badges on canvas chips
3. Add zoom/pan for canvas
