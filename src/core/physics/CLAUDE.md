# Physics Engine

Custom rigid body physics engine (not a wrapper around another library).

## Architecture

- **World** - Central container managing bodies, constraints, springs, and collision
- **Body** - Single concrete `Body` class tagged by readonly `shape` (`pm2d`/`rigid2d`) and `motion` (`static`/`kinematic`/`dynamic`). Narrowed interface views in `bodyInterfaces.ts`; construct via factories in `bodyFactories.ts` (`createRigid2D`, `createPointMass2D`) for type-level narrowing. Rigid bodies carry scalar `angle`/`angularVelocity`/`angularForce`/`inertia`; point masses ignore them.
- **Systems** - Per-concern modules in `systems/` (AABB, Damping, Force, Integration, MassProperties, Sleep) operate on partitioned body buckets. The solver step in `World.step()` drives them in order.
- **Shapes** - Circle, Box, Convex, Capsule, Particle, Line, Plane, Heightfield attached to bodies. `utils/fromPolygon.ts` decomposes concave outlines into `Convex` pieces.
- **Collision** - Broadphase (spatial hashing or SAP) → Narrowphase → Contact generation

## Key Patterns

### Island Splitting

Connected bodies form "islands" that can sleep together. See `world/Island.ts`.

### Solver Pipeline

1. Broadphase finds potential pairs
2. Narrowphase generates ContactEquations
3. GSSolver iterates to resolve constraints

### Equation Shape Taxonomy

The solver partitions equations into "shape" groups based on which components
of the Jacobian are structurally non-zero. Each group gets a dedicated
monomorphic inner loop in `GSSolver.runIteration`, so the hot math never pays
for zero multiplies, wasted `invInertia` reads, or virtual dispatch.

The generalized velocity is 6 components: `[vxA, vyA, wA, vxB, vyB, wB]`.
The workspace stores `vlambda` as 2 floats per body and `wlambda` as 1 float
per body; `invMassSolve` and `invInertia` are scalars per body.

| Shape                 | Class (extends `Equation`) | Non-zero `G`                                        | When to use                                                                                                             |
| --------------------- | -------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **point-to-point 2D** | `PointToPointEquation2D`   | `G[0..1]`, `G[3..4]` (symmetric: `-n` / `+n`)       | Both bodies are point masses (no angular contribution). Rope chain links.                                               |
| **point-to-rigid 2D** | `PointToRigidEquation2D`   | `G[0..1]`, `G[3..5]` (A linear only; B lin + ang)   | One side is a point mass, the other a rigid body. **Convention: the point is always `bodyA`.**                          |
| **planar 2D**         | `PlanarEquation2D`         | `G[0..2]`, `G[3..5]` (shared linear ±, own angular) | Rigid-rigid contacts and friction. `ContactEquation`, `FrictionEquation`.                                               |
| **angular 2D**        | `AngularEquation2D`        | `G[2]`, `G[5]` (asymmetric — supports gear ratios)  | Pure rotational coupling. `RotationalLockEquation`, `AngleLockEquation`, `RotationalVelocityEquation` (motor).          |
| **general**           | `Equation` (base)          | Any combination (full 6 components)                 | Anything that doesn't fit a specialized shape (e.g. `RevoluteConstraint`'s pivot equations). Prefer a shape if you can. |

Each shape class:

- Stores only the non-zero components as named fields instead of a 6-element `G`.
- Overrides `computeGq` to return the inherited `offset` field; the owning
  constraint's `update()` writes `offset` to the signed position error each
  substep.
- Overrides `computeGW`, `computeGWlambda`, `computeGiMf`, `computeGiMGt`,
  and `addToWlambda` with reduced-arithmetic versions that skip the
  structurally-zero terms.

When writing a new constraint, pick the shape that matches its Jacobian
structure and extend that equation class. Don't instantiate the base
`Equation` directly unless the constraint genuinely has a fully general
6-component Jacobian — you'll miss out on the shape-specialized solver
path and pay for arithmetic against zeros.

Equation partitioning happens once in `prepareSolverStep` via `instanceof`
checks. `SolverWorkspace` holds a dedicated array per shape group, and
`runIteration` dispatches to the matching `iterateXxxBatch` function. See
`GSSolver.ts` for the iterator implementations.

### Solver Workspace Layout

`SolverWorkspace` assigns each body an integer index `i` for the duration of a
solve and stores per-body state in flat `Float64Array`s:

- `vlambda[i * 2]`, `vlambda[i * 2 + 1]` — accumulated linear velocity change
- `wlambda[i]` — accumulated angular velocity change
- `invMassSolve[i]`, `invInertia[i]` — scalar inverse mass / inertia (zero for
  static, kinematic and sleeping bodies; `invInertia` is also zero for point
  masses)

Per-equation `lambda`, `Bs` and `invCs` are `Float32Array`s indexed by the
equation's slot.

### Friction

With `solverConfig.frictionIterations === 0` (the default) friction equations
are bounded by a constant slip force and ignore `ContactMaterial.friction`.
Set `frictionIterations > 0` to derive the bound from the contact force
(`friction × average normal force`); then frictionless contacts get no
friction equations at all.

### Per-step objects are reused

Contact and friction equations come from an `EquationPool`, and `Collision`s,
`CollisionResult`s and their contacts from pools in `CollisionResult.ts` and
`getContactsFromCollisionPairs.ts`. All of them are released at the start of
the next step, so they're only good during the step they come from. Anything
that hands them out (like the contact events) must say so, and callers must copy
what they keep. A new narrowphase handler fills in contacts from
`addContact(result)` rather than pushing new objects, and a new shape's
`computeAABB` must write into `out` when it's given.

### Substepping

`World.step(dt)` supports splitting the constraint-solve + position-integrate
phase into `N = WorldOptions.substeps` iterations at `h = dt / N`. Broadphase,
narrowphase, and contact/friction equation generation run once per step;
entity-applied forces are folded into velocity once at the full `dt`; then
the substep loop refreshes constraint Jacobians (`constraint.update()`),
solves at `h`, and advances positions at `h`. This stiffens ropes and other
long constraint chains without multiplying collision detection cost. Default
is `1` (legacy behavior).

### Adding New Collision Types

1. Create shape in `shapes/`
2. Add narrowphase handler in `collision/narrowphase/shape-on-shape/`
3. Register in the shape-pair dispatch table

## Common Tasks

- **Raycast**: `world.raycast(from, to, options)` - see RaycastOptions for filtering. `collisionMask` is matched against shapes' `collisionGroup` only; respect a shape's own mask in `filter`.
- **Sensors moved by hand**: only pairs with a dynamic body are tested, so make it dynamic with `mass: 0, collisionResponse: false`.
- **Queries between steps** see bodies where the last step left them: moving a body by hand doesn't update its AABB or broadphase cell until the next step.
- **Resizing a shape**: not supported (a `Box`'s `width` doesn't change its vertices); replace the shape.
- More tips for game code are under "Practical tips" in `README.md`.
- **Body sleeping**: Configure via `world.sleepMode` (`SleepMode.NO_SLEEPING`, `BODY_SLEEPING`, `ISLAND_SLEEPING`; the last needs `islandSplit: true`)
