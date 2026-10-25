# User guide

Atrapos lets you plan routes on a map, add points of interest (POIs), and send both to your Suunto app so they appear on your watch. This guide explains how to use it. It does not cover installing or hosting the app; for that see the [README](../README.md).

> Atrapos works with Suunto but is not affiliated with or endorsed by Suunto. Suunto is a trademark of its owner.

## Contents

1. [The basics](#1-the-basics)
2. [Signing in](#2-signing-in)
3. [Your route library](#3-your-route-library)
4. [Drawing a route](#4-drawing-a-route)
5. [Points of interest](#5-points-of-interest)
6. [Importing files](#6-importing-files)
7. [GPX tools](#7-gpx-tools)
8. [Sending to Suunto](#8-sending-to-suunto)
9. [Your profile and preferences](#9-your-profile-and-preferences)
10. [Keyboard shortcuts](#10-keyboard-shortcuts)
11. [Troubleshooting and questions](#11-troubleshooting-and-questions)

---

## 1. The basics

- **A route** is a line on the map, with distance, ascent and descent. It can have POIs along it.
- **A POI** is a named point such as a spring, a hut or a summit. It can sit on a route or stand alone.
- **Your data stays in this app** until you press a **Push** button. Nothing is sent to Suunto automatically.
- **Suunto changes come to you only when you ask.** Use **Refresh from Suunto** to fetch changes made in the Suunto app.

The top navigation has three pages: **Library** (your routes), **All POIs** and **GPX tools**. Your account menu (top right) holds your profile, Suunto connection and sign out.

## 2. Signing in

You can sign in two ways on the first screen:

| Option | Use it when |
|---|---|
| **Sign in with Google** | You want your own app account. Suunto is optional and can be connected later. |
| **Sign in with Suunto** | You want to work directly with the routes and POIs in your Suunto account. |

Good to know:

- Google and Suunto sign-ins create **separate accounts**. Routes in one are not visible in the other, until you connect them (see below).
- Suunto sign-in uses Suunto's own page. This app never sees your Suunto password.
- If your sign-in is refused with a message about the allowlist, the owner of this app limits who may use it. Ask them to add you.
- Sessions last for weeks. Use **Sign out** in the account menu on a shared computer.

### Connecting Suunto to a Google account

1. Open the account menu and choose **Connect Suunto**.
2. Confirm in the dialog and sign in on Suunto's page.
3. If you already had a Suunto-only account, its routes and POIs are **merged** into your Google account. If the same route or POI exists in both, the Suunto account's copy is kept.

### Disconnecting Suunto

Choose **Disconnect Suunto** in the account menu. The app stops having access to your Suunto account. Your routes and POIs stay in the app. If you signed in with Suunto only, you are signed out as well.

## 3. Your route library

The **Library** page ("My routes") shows everything you have.

**Summary tiles** at the top show totals: routes, distance, climbing and POIs. The tiles **Not pushed** and **Needs attention** also work as filters; click one to see only those routes.

**Three ways to look:**

| View | Shows |
|---|---|
| **Boxes** | A card per route with its outline |
| **List** | A table you can sort by clicking the column headings |
| **Map** | All your routes on one map |

The view you choose is remembered in your browser.

**Finding routes:**

- **Search** by name (case and accents are ignored).
- **Filter** by sync status or by activity.
- **Sort** by date, name, distance, ascent, POIs or status.

**Selecting several routes:** use the checkbox on a route; hold **Shift** and click to select a range. With a selection you can delete several routes at once.

**Per-route buttons:** push the route to Suunto, push its POIs, download as GPX, and delete. The two push buttons appear when your Suunto account is connected. They work as in the editor: **Push route** is disabled when Suunto already has your version, and **Push POIs** when there are no POIs or all are pushed. A toast reports the result; if the route changed in Suunto too, it links to the editor to resolve the conflict. In the Boxes view the four buttons are arranged in two rows (push route and push POIs above, download and delete below). Open a route by clicking its name or outline.

**Creating routes:**

- **New route** starts a blank route in the editor. The route is added to your library only after you place at least one point and save.
- **Import GPX / FIT** (or dropping a GPX or FIT file onto the page) imports a file. See [Importing files](#6-importing-files).

> **Deleting is local only.** Suunto has no delete function for apps like this one. A deleted route that is still on Suunto can reappear when you next press **Refresh from Suunto**. To remove it everywhere, delete it in the Suunto app as well.

## 4. Drawing a route

Open a route (or choose **New route**) to get the editor: a map with a toolbar, a side panel with three tabs (**Route**, **POIs** and **Weather**), and an elevation profile.

### The toolbar

| Tool | What it does |
|---|---|
| **Select and drag points** | Move and select existing points |
| **Extend route** | Click the map to add points to the end |
| **Add POI** | Click the map to place a POI |
| **Analyse a section** | Click two points on the route to measure the part between |
| **Drawing mode** | Choose *snap* or *freehand* for new segments |
| **Undo / Redo** | Step back and forward through your edits |
| **Reverse route direction** | Flip start and end |
| **Fit route in view** | Zoom to the whole route |
| **Go to my location** | Centre the map on where you are |
| **Base map** | Switch between OpenStreetMap, OpenTopoMap and CyclOSM |

You can also search for a town, peak or address with the **place search** on the map to jump there.

### Snap or freehand

Each segment between two points is drawn in one of two modes:

- **Snap to trail:** the line follows paths and roads. Pick a **routing profile** (several hiking and bike profiles are available) for the route. If you click too far from any trail, the segment falls back to a straight line and you see a notice.
- **Freehand:** a straight line between the points, wherever you click.

You can mix both in one route and change a segment's mode later by selecting its point.

### Editing

- **Drag a point** to move it. Only the segments next to it are redrawn.
- **Drag the line** to insert a new point.
- **Right-click a point** to delete it.
- **Select a point** to get a bar with more actions: change the segment mode, **trim** everything before or after it, **split** the route there, **start the loop here** (loops only), or delete it.
- **Start loop here** appears for a loop (a route that ends within 25 m of where it starts) when you select a point in the middle. The route stays exactly the same, but it now starts and ends at that point. Snap and freehand segments are kept as they are, and it can be undone. The ascent and descent totals can change slightly because the profile begins elsewhere.
- **Reverse** flips the direction. Snapped segments are redrawn so that one-way paths are respected.
- **Split here** turns the route into two routes: the first part stays, the second becomes "*name* (part 2)" together with its POIs. A split cannot be undone, so the app asks first.

Every edit except split can be undone with **Ctrl+Z** and redone with **Ctrl+Y**.

### Saving

Routes are saved only when you press **Save**. If you try to leave with unsaved changes, the app asks whether to save or discard them. Pressing **Save** is also what makes a new route appear in your library.

### Route details

In the **Route** tab of the side panel you can set:

- the route **name** and **description**
- the **activities** it is for (for example Hiking or Trail running)
- **turn-by-turn waypoints** for Suunto (Suunto creates its own turn guidance)
- the **routing profile** used when snapping

### Elevation profile and numbers

The profile under the map shows height along the route. Hovering it highlights the matching spot on the map and the other way round. Distance, ascent and descent are shown for the route. The climbing totals are calculated from a smoothed profile (about ±50 m), and only climbs and descents of 5 m or more are counted, so noise in the elevation data does not inflate them, and real hills, including small rolling ones, are not lost. The same calculation is used for sections. Routes imported without elevation stay without it.

### Analysing a section

To measure just part of a route:

- **Drag across the elevation profile** (then drag the handles to adjust), or
- choose the **ruler** tool and click two points on the route, or two of its markers.

You get distance, ascent, descent, net change, average and steepest grades, the highest and lowest points, and the POIs in that part. The section is highlighted on the map, and **Zoom to section** fits it. Press **Esc** to clear it. Sections are not saved.

### Weather

For a saved route, the **Weather** tab shows a 7-day forecast along the route: daily summaries, and three-hour forecasts you can expand, in the route's local time. Forecasts are fetched only when you open the panel and are estimates, not guarantees. Data is from Open-Meteo.

## 5. Points of interest

### Adding and editing

1. Choose the **Add POI** tool and click the map. A click near the route snaps the POI onto it.
2. Give it a **name**, an optional **description**, and a **type**. There are 61 Suunto POI types (water, camp, peak, parking, danger and many more), each with an icon.
3. Drag a POI to move it, or edit it in the **POIs** tab of the side panel.

POIs on a route are listed in route order and also shown on the elevation profile. Everything about POIs can be undone, like route edits. POIs belong to the route and are saved when you press **Save**.

### On the route or off it

A POI within 200 m of the route line is **on the route**. It gets a position along the route, and when you push, it also becomes a waypoint in the route so your watch can alert you as you pass it. A POI farther away is **off route**: it can still be sent to Suunto as a POI, but not as a route waypoint.

### The All POIs page

**All POIs** lists every POI, grouped by route, with standalone POIs (such as those pulled from Suunto) at the end. View it as a list or on a map, search and filter, select several (Shift-click for a range), delete them in bulk, or **push the selected POIs** to Suunto.

> Deleted POIs are also removed only locally. If you undo a delete right after, the POI returns as the same one, so no duplicate is created on Suunto.

## 6. Importing files

You can import:

- **GPX** files (1.0 and 1.1): tracks, routes and waypoints, including Suunto's own route points
- **FIT** course files (with course points) and FIT activity files (with laps)

**To import:** press **Import GPX / FIT** on the Library page, or drop a file onto the page. A preview opens:

1. Pick the **track** if the file has several.
2. Use the **Simplify tolerance** slider to reduce the number of points. The point count updates live; higher tolerance means fewer points and a smoother, lighter route.
3. Set the **route name** and the **Suunto activities**.
4. Tick the **waypoints** to import as POIs. Each gets a suggested Suunto type that you can change. Turn instructions and lap markers from FIT files are unchecked by default, because Suunto makes its own turn-by-turn.
5. Confirm to create the route.

Notes:

- Waypoints more than 200 m from the track become POIs without a position along the route.
- Elevation is not looked up during import. Tracks without elevation are imported without it.
- Very large files are refused. The size limit is set by whoever runs the app (20 MB by default) and is shown when you choose a file.
- The original file is kept with the route.

## 7. GPX tools

The **GPX tools** page works on route files without needing them in your library first.

| Tool | What it does |
|---|---|
| **Merge GPX files** | Combine several tracks or routes into one ordered route and create it in the app |
| **Split a GPX route** | View a file on a map, click to add split points, then download the parts or create a route for each part |
| **Shrink a GPX or FIT file** | Reduce the size and number of points, then download the smaller file |
| **Convert FIT and GPX** | Turn a GPX into a FIT course or a FIT into a GPX, and download it. The first track is converted point for point; elevation, recorded times and waypoints are kept where the format supports them |

## 8. Sending to Suunto

You need a Suunto account connected (sign in with Suunto, or **Connect Suunto** from a Google account). The route page has a **Sync to Suunto app** panel with two separate rows: **Route** and **POIs**.

### Statuses

| Status | Meaning |
|---|---|
| Local only | Never sent to Suunto |
| Synced | Suunto has this version |
| Local changes | You edited it since the last push |
| Remote newer | It changed in the Suunto app since the last sync |
| Conflict | It changed in both places; you need to choose |
| Error | The last push failed |

### Pushing a route

Press **Push route** (in the editor, or the upload icon on the dashboard). The first push creates the route in Suunto; later pushes update it. The button shows **Pushed** when Suunto already has your version, and needs at least two points on the route. A route sent to Suunto is lightly simplified (2 m) to keep it small.

### Pushing POIs

Press **Push *n* POIs** (or the pin icon with an arrow on the dashboard). POIs are sent one at a time, and you get a result for each. One failure doesn't stop the others; use **Retry** for those that failed. POIs near the route are also written into the route as waypoints, so push the route again after changing them if you want the route on your watch to have the latest waypoints.

On the **All POIs** page you can push a selection of POIs from several routes at once.

### When there's a conflict

If you pushed a route earlier and it has since been changed in the Suunto app, the app never overwrites it silently. A dialog shows both versions and offers:

- **Keep mine and push it on top:** your version replaces Suunto's.
- **Load the Suunto version (discard my edits):** Suunto's version replaces yours.
- **Save mine as a new route, then load Suunto's:** keeps both, as two routes.
- **Decide later:** closes the dialog; the route stays marked as a conflict.

If the route was deleted in the Suunto app, the choices are to upload it again as a new route, or to keep it in this app only.

### Refreshing from Suunto

On the Library page, **Refresh from Suunto** fetches your routes and POIs from Suunto. New and updated items are imported. Items you edited locally are kept and marked as conflicts instead of being overwritten, and you are asked to confirm first. Suunto does not allow constant polling, so nothing is fetched until you press this button.

Route waypoints stay part of their route; a waypoint is shown as a POI only when it matches a POI that Suunto also returns separately.

### Downloading a route

Every route can be downloaded as a **GPX** file with all its POIs, for use in other apps.

### Short waits

While the app talks to Suunto, a progress bar appears under the top bar and the buttons show a spinner. This can take a few seconds.

## 9. Your profile and preferences

Open your profile from the account menu. It shows the accounts you have connected, and lets you set preferences that follow you on every browser:

| Setting | Options |
|---|---|
| **Default map** | The base map new routes open with |
| **Units** | Metric or imperial |
| **Appearance** | Dark or light |
| **Design** | **Classic** (dark glass look), **Alpine** (light and editorial) or **Soft** (warm and rounded, with a left icon rail). Each works in both dark and light appearance |

The moon/sun button in the top bar also switches between dark and light.

On a phone, the main navigation moves to a bar at the bottom of the screen.

## 10. Keyboard shortcuts

| Keys | Action |
|---|---|
| **Ctrl+Z** | Undo the last edit |
| **Ctrl+Y** | Redo |
| **Esc** | Clear the analysed section |
| **Shift+click** | Select a range of routes or POIs in lists |

The app can be used with the keyboard alone, and has a "skip to content" link at the top of each page.

## 11. Troubleshooting and questions

**I can't sign in with Google.**
Google sign-in is optional and may not be set up by whoever runs the app. If you see "This account isn't allowed", ask the owner to add you to the allowlist. If your browser blocks pop-ups, allow them for this site; the app falls back to a normal page when it can.

**"Access was not approved on Suunto."**
On Suunto's page, choose **Allow** to give the app access, then try again.

**"The sign-in link expired or was opened in another browser."**
Start the sign-in again from this app's login page, in the same browser.

**The app says Suunto isn't connected, or asks me to sign in again.**
Your Suunto session has ended. Sign in with Suunto again, or choose **Connect Suunto** from your account menu.

**A POI failed to push.**
Open the push result for the reason, and use **Retry**. Check the POI has a name and a valid position. If it keeps failing, tell whoever runs the app which POI it is and roughly when; they can look it up in the error log.

**A route I deleted came back.**
Suunto keeps its own copy, and **Refresh from Suunto** brings it back. Delete it in the Suunto app too.

**Snap to trail drew a straight line.**
No trail was found within a few hundred metres of your click, or the routing service didn't answer. Click closer to a path, or use freehand. If the service is unavailable you can retry.

**The elevation profile is empty or flat.**
Elevation comes from a public service and may be turned off or busy, or the imported file had none. Edit the route, or try again later.

**Where is my data?**
In the database of the app you signed in to. Suunto sign-in uses Suunto's page, so your Suunto password is never given to this app.

**Does the app work on a phone?**
Yes. The layout adapts, with a bottom navigation bar.
