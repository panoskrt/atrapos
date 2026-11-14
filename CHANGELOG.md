# Changelog

## 2026-11-14

### Fixed

- Importing a GPX file downloaded from Atrapos no longer duplicates POIs. A POI near the route but not exactly on the line was listed in the file twice (at its own spot and at its spot on the route) and came back as two POIs; it now comes back once, at its own position. Files downloaded before this fix import correctly too.

## 2026-11-13

### Fixed

- Editing an imported route no longer turns parts of it into straight lines. Imported segments are kept exactly as recorded until you move one of their ends; then that segment is routed along paths, and the rest of the track is left alone. Deleting a point between two imported segments keeps the line as it was.
- Dropping a point away from any trail no longer turns its segments into straight lines for good. They are shown dashed with a notice, are routed again as soon as you move the point onto a path, and only become straight lines if you choose *Use a straight line*.

## 2026-11-12

### Added

- Add a point anywhere on a route in the editor: a handle follows the pointer along the line. Drag it to add a point and move it in one step, or click (or tap) the line in select mode to add a point at that spot and then drag it to adjust the route from there. A clicked point leaves the line exactly as it was, so imported tracks and snapped trails are not redrawn.

## 2026-11-09

### Added

- Choose where the main menu appears: a left-side icon rail or the top bar. The selection is saved to your account, menu styling is consistent across themes, and phones continue to use bottom navigation.
- Collapse the map tools bar (closed by default) and location search (closed by default) to free up map space. The route and elevation panels can also be collapsed, with their state remembered by the editor.

## 2026-11-08

### Added

- Split routes by distance in the route editor and GPX tools. Parts are created at the nearest control points to the chosen interval; the original route remains unchanged and POIs are copied to their corresponding parts.
- Save favorite sports and an optional default routing profile in account preferences. Favorite sports appear as quick choices when planning routes; when no default profile is set, routing suggestions continue to follow the selected sport.

## 2026-11-02

### Added

- Add an admin statistics page with selectable date ranges and daily, weekly, or monthly charts for new users, routes, POIs, imported files, Suunto route and POI pushes, and logged errors.
