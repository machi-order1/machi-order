# MACHI ORDER Design Platform V65

## Product rule
UI is a product asset, not page-by-page decoration.

## Central tokens
Background, surfaces, ink, muted text, borders, accent, radii, shadow, touch target, spacing and typography live in `machi-design-system.css`.

## Components
Use reusable card/button/badge/page primitives. Staff pages should not invent their own interaction vocabulary.

## Flexible operations
- Menu/products remain data-driven from DB/API; new menu items should not require rebuilding the app shell.
- Roles determine the actions a staff member sees.
- Store/brand presentation should be configuration, not duplicated source code.
- Workflow state labels/buttons should be mapped centrally as the operation evolves.
- Customer ordering and staff operations stay separate surfaces but share the same design language.

## Upgrade path
V65 adds central design tokens and a device-local settings preview. Next production step is persisted brand/store UI settings through authenticated API, then dynamic menu/operation configuration.

## Guardrails
No store workflow is hard-coded based on gender/age. No incomplete accounting data is presented as final profit. Production Netlify remains unchanged.
