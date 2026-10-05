# Adventure interface

Version 0.2.0 gives every existing flow a consistent pixel-game presentation:
onboarding and login, world overview and cards, the creation wizard, all eleven
server tabs, users, activity, application preferences and modal dialogs. The
application still shows actual server data and unavailable metrics remain unknown.

## Interactive companions

The original articulated SVG interpretations of Alex, a Creeper, a pig and a bee
live in `packages/ui/src/characters.tsx`. Legs, arms, eyes, wings and tools animate
independently. The companions wander within separate lanes, face their direction
of travel and stop wandering while a companion has keyboard focus or is dragged.

- Click or press Enter/Space to interact. A contextual speech bubble and hearts
  respond to the current page; optional sound and bounded pixel particles follow.
- Drag a character horizontally, or use Left/Right while it has keyboard focus.
- Settings and update views give Alex a moving pickaxe. Backups make the pig sniff
  toward a treasure chest. Networking brings a glowing portal near the Creeper.
- Successful operation events trigger the celebration. It is driven by actual
  completion, not a placeholder success result or a fabricated achievement score.
- The companion menu pauses the cast, starts a playful dance or hides companions.
  The preference persists and can be changed again under Settings.

The cast occupies a reserved strip outside the scrollable application content.
Its decorative layers ignore pointer events. Modal overlays remain above it.
Responsive percentage positions follow viewport changes. Hidden documents stop
wandering and audio; landscapes outside the viewport pause their animations.

## Sound and motion preferences

`packages/ui/src/sound.ts` synthesizes eleven sound categories with Web Audio:
interface, hover, wood, stone, crafting, success, warning, portal, chest, pet and
ambience. There are no copied Minecraft recordings, remote audio fetches or
autoplay on first use. Audio is muted by default and unlocks after interaction.
Hover never creates a fresh AudioContext. Simultaneous voices are bounded and
ended nodes disconnect. Mute stops active and scheduled voices immediately;
volume zero never schedules a voice.

Settings offers separate interface/ambient volume, a sound playground, reduced
visual effects and companion visibility. Values are validated, clamped and stored
under `minemate.preferences`; unavailable storage does not prevent using the UI.
Both the application preference and `prefers-reduced-motion` suppress decorative
CSS/SVG motion, canvas bursts, automatic character movement and Motion transforms.
The characters remain operable with reduced motion.

## Assets and maintenance

- `apps/web/public/art/overworld.png`: original generated panorama created for
  MineMate. The same cached local asset grounds the hero, login and world windows.
- `packages/ui/src/assets.tsx`: the original pixel item registry and landscape.
- `packages/ui/src/characters.tsx`: original jointed character sprites.
- `apps/web/public/fonts/`: locally served Silkscreen Regular/Bold from the Google
  Fonts Silkscreen project; the SIL Open Font License is included as `OFL.txt`.
- `apps/web/src/adventure.css`: shared visual skin, animation vocabulary,
  responsive rules and motion overrides. Existing structural layouts remain in
  `styles.css`.
- `apps/web/src/Experience.tsx`: preferences, scene context, bounded canvas
  particles and actual completion feedback.
- `apps/web/src/Companions.tsx`: cast behavior and pointer/keyboard interaction.

All fonts and visual assets ship in the Docker image. No third-party browser
requests are needed for the design. The UI is an independent Minecraft-inspired
design and does not redistribute original game assets or music.

## Verification

Five browser tests exercise the original complete management flow, German mobile
layout, wandering/clicking/dragging/keyboard control, scene reactions, persistent
companion visibility, real Web Audio opt-in/mute/zero volume, persisted preferences,
all eleven server tabs on a 390-pixel viewport, and OS/application reduced motion.
Screenshots are captured with animations settled; the application itself stays
animated unless its preferences request otherwise.
