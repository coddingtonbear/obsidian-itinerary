# Obsidian Itinerary

Planning a vacation or need to otherwise see a set of events on a monthly, weekly, or daily calendar?  If so -- obsidian itinerary can help you keep your plans in order.

## Quickstart

Imagine you have a document outlining what you want to do during an upcoming trip to Mexico; you could try to keep track of things in text like this:

~~~
# Trip to Mexico

Finally a chance to explore again.

## Oaxaca

Hotel: Hotel Fortin Plaza; check-in 5pm on 31 October check-out by 11am on 4 November

### Day of the dead Parade

Noon on November 1st

See more information here: https://thehaphazardtraveler.com/day-of-the-dead-in-oaxaca/

### Flight to CDMX

Volaris Flight 765; 12:31pm on November 10th, landing at 1:49pm

## Mexico City

Hotel: Zócalo Central Hotel; check-in 3pm on November 4th, check-out by 10am on November 10th
~~~

Mostly, though, it's up to your reading ability to keep track of what you have planned for each day, and it's really easy to lose track of things and put yourself into a situation where you forgot to book a hotel one night, or maybe had two conflicting events.

Obsidian Itinerary helps with this by letting you specify events and event calendar displays using a simple format; e.g.:

~~~
# Trip to Mexico

```itinerary
initialDate: 2021-11-01
```

## Oaxaca

```itinerary-event
title: Oaxaca
allDay: true
start: 2021-10-31
end: 2021-11-04
color: red
```

### Hotel

```itinerary-event
title: Hotel Fortin Plaza
start: 2021-10-31T17:00
end: 2021-11-04T11:00
color: brown
tag:
- hotel
```

**Hotel Fortin Plaza**
Address: Venus 118, Estrella, 68040 Oaxaca de Juárez, Oax., Mexico
Phone: : +52 951 515 7777

### Day of the dead Parade

```itinerary-event
title: Day of the Dead Parade
start: 2021-11-01T12:00
color: blue
tag:
- outing
```

See more information here: https://thehaphazardtraveler.com/day-of-the-dead-in-oaxaca/

### Other Plans

```itinerary-event
title: Drinks with Tom
start: 2021-11-01T19:00
end: 2021-11-01T21:00
tag:
- friends
```

### Flight to CDMX

```itinerary-event
title: Volaris Flight 765
start: 2021-11-04T12:31
startTimeZone: America/Los_Angeles
end: 2021-11-04T13:49
endTimeZone: America/Mexico_City
color: green
tag:
- flight
```

## Mexico City

```itinerary-event
title: Mexico City
allDay: true
start: 2021-11-04
end: 2021-11-08
color: red
```
~~~

And as a reward for your effort, you can then render calendars for your various plans, e.g:

![](http://coddingtonbear-public.s3.amazonaws.com/github/obsidian-itinerary/overview.png)

### Inserting events with a form

If you'd rather not remember which fields an event takes, run **Itinerary: Insert event** from the command palette (or give it a hotkey under Settings → Hotkeys).  It opens a form asking for the event's title, start and end, whether it's all-day, the time zones its start and end are in, tags and color, and writes a finished `itinerary-event` block at your cursor.

- Turning on **All day** switches the start and end to dates and hides the time zones, which don't apply to whole days.
- For an all-day event, the form asks for the **last day** the event covers and writes the day after as its `end`, since all-day `end` dates are exclusive (see "Itinerary Event Options" below).
- Both time zones start out as your computer's own, and the end's zone follows the start's until you change it, so only an event that ends somewhere else (a flight, say) needs both set.  When they're the same the form writes one `timeZone`; when they differ, `startTimeZone` and `endTimeZone` (see "Timezones" below).  If you're planning from home for somewhere else, set the start's zone to the destination's.  Clear a zone to leave it out, so the time is read in whatever zone the event is displayed in.
- The time zone fields suggest zone names as you type (`new york` finds `America/New_York`).
- The end can't be before the start, comparing the two in their own zones: a flight that lands at an earlier clock time than it took off is fine.
- The tags field suggests tags already used by events in the same note.

To change an event later, click the pencil button on its summary in your note.  The same form opens, filled in with the event's values, and **Save** rewrites the block where it is.

- Fields the form doesn't show (`url`, `display`, `backgroundColor`, and any other event option) are kept as they were, after the form's own.  Comments in the block aren't kept.
- A time written with an offset or zone (`2021-11-01T12:00Z`, `…+05:30`, `…[Europe/Paris]`) is shown as the same moment on the clock of the event's time zone, or of the zone it was written in if the event has none; saving writes it that way.
- A tag containing a comma can't be typed in the tags field, so it isn't shown there, but it is kept.
- If the block changes in the note while the form is open, saving leaves it alone and says so.


## Options

### Itinerary Options

You can specify the following options for displaying your itinerary:

- `source`: A link to the note (or a list of links to the notes) to gather events from, e.g. `"[[My Vacation Plans]]"`.  Links resolve exactly as they do elsewhere in Obsidian, so a note's name is usually enough even if it lives in a subfolder.  Defaults to events found in the same note the calendar is rendered in.  This field also accepts a path relative to your vault root (e.g. `Trips/Mexico.md`) instead of a link, but a link is recommended since the editor can autocomplete it.  A path may name a note you haven't created yet: the itinerary says so below the calendar, and shows the note's events once it exists.  If you rename or move a source note, open itineraries follow it, but Obsidian doesn't update links inside code blocks, so update the `source` too.
- `filter`: A list of filter expressions (see "Expressions" below) or a single filter expression to use for limiting which events will be displayed. If unspecified, all events found in the selected sources will be included.
- `debug`: If `true`, prints some debugging information below your rendered itinerary: which events each filter let through or left out (and why), and any calendar options that were translated for FullCalendar 7.

In addition to the above, you can provide any options described in [FullCalendar's documentation](https://fullcalendar.io/docs) (this plugin uses FullCalendar 7).  Date format options accept either FullCalendar's format objects or [Luxon format strings](https://moment.github.io/luxon/#/formatting?id=table-of-tokens) such as `titleFormat: "MMMM yyyy"`.  Particularly useful properties include:

- `initialDate`: The date to focus on your calendar.  This can be useful for displaying a different month than your current date, for example.  Defaults to the current date.
- `initialView`: What kind of calendar to show; by default, a `dayGridMonth` view will be shown, but the options include:
  - For display of dates in a calendar grid (see https://fullcalendar.io/docs/daygrid-view)
    - `dayGridMonth`: Shows a whole calendar month.
    - `dayGridWeek`: Shows a single week.
  - For displaying a time grid (see https://fullcalendar.io/docs/timegrid-view)
    - `timeGridWeek`: Shows a time grid for a whole week.
    - `timeGridDay`: Shows a time grid for a single day.
  - For a simple list display (see https://fullcalendar.io/docs/list-view)
    - `listYear`: For a whole year.
    - `listMonth`: For a single month.
    - `listWeek`: For a single week.
    - `listDay` For a single day.

### Itinerary Event Options

You can specify the following options for events:

- `title`: (Required) A name for your event.
- `start`: (Required) An ISO timestamp representing your event's start time.
- `end`: An ISO timestamp representing your event's end time.  For all-day events, this date is *exclusive*: an event with `start: 2021-10-31` and `end: 2021-11-04` covers October 31st through November 3rd.
- `timeZone`, `startTimeZone`, `endTimeZone`: The time zone your event's times were written in; see "Timezones" below.
- `tag`: A single string tag or list of tags to associate with this event.  These are useful for specifically marking things like flights or hotel stays so you can generate calendars showing only one kind of event.
- `hidden`: If `true`, this event will not be rendered individually in your notes where you've specified your event, and instead will appear only on relevant itineraries.  Defaults to `false`.

Additionally, you can provide any options described here:  https://fullcalendar.io/docs/event-parsing; particularly useful properties include:

- `color`: For marking your events in a particular color.  You can also set `backgroundColor`, `borderColor` and `textColor` separately; the calendar draws events in `backgroundColor` with `textColor` text, and the event summaries in your notes use all three.
- `allDay`: For marking your event as an "all-day" event.  An event whose `start` and `end` are dates without times is all-day even if you leave this out.

### Expressions

This library uses `filtrex` for expression evaluation; see their documentation to see more information about the expression syntax and what functions are available: https://github.com/cshaa/filtrex#expressions.

Any of an event's options can be used in an expression.  An option an event doesn't set is simply empty: `tag` is always treated as a list (so `"hotel" in tag` works whether an event has one tag, several, or none), `allDay` and `hidden` default to `false`, and anything else reads as empty.

A few things worth knowing about the syntax:

- `<`, `<=`, `>` and `>=` compare two numbers or two pieces of text; since dates are written as ISO text, `start >= "2021-11-01" and start < "2021-11-02"` picks out a single day's events.
- `tag == "hotel"` matches an event whose *only* tag is `hotel`; use `"hotel" in tag` to match any event tagged `hotel`, and `empty(tag)` to match untagged events.
- `not`, `and` and `or` need `true`/`false` values, so `not color` is an error for an event without a color, and `not tag` is an error for every event; use `"hotel" not in tag`, or a bare `tag` to pick out tagged events.  With `debug: true`, the itinerary explains why each event was left out.

See "Filtering events based upon tag" for an example of a filter expression in action, but realistically they work exactly as you'd probably expect.

## Tips

### Rendering information for a single day

Say that you have a particularly complicated day that you'd like to render to make sure you've left yourself enough time between things:

~~~
```itinerary
initialDate: 2021-11-01
initialView: listDay
```
~~~

![](http://coddingtonbear-public.s3.amazonaws.com/github/obsidian-itinerary/listDay.png)

Try using `timeGridDay`, too!


### Rendering a span of time that isn't a week or day

Imagine that you're going to be in some particular place for exactly four days; with the default `dayGrid` or `weekGrid` views, you'd have either not all of the relevant events displayed or you'd have many blank days shown.  You can instead render a particular number of days easily by using the `duration` option:

~~~
```itinerary
initialDate: 2021-10-22
initialView: dayGrid
duration:
  days: 4
```
~~~

This option works for several of the grid options; try `timeGrid`, too, if you need more detail.

### Filtering events to show only all-day events

This is particularly easily done since `allDay` is an event property:

~~~
```itinerary
filter:
- allDay
```
~~~

### Filtering events based upon tag

You can filter events based upon what tags are available easily, for example:

~~~
```itinerary
filter:
- '"hotel" in tag'
```
~~~

or 

~~~
```itinerary
filter:
- '"hotel" not in tag'
```
~~~


Note that the single quotes surrounding the whole expression are necessary given that this is a YAML document, and YAML documents have some parsing rules that make this just slightly awkward.

### Timezones

Itineraries and events are timezone-aware and will by default interpret your events and display your itineraries using your local timezone.  You can, though, override that easily.

#### Itinerary

If you're planning a proper adventure, you might be far from home for part of your trip, and might want a particular itinerary to be displayed in that locale's timezone.  To do that, you can use the `timeZone` property; e.g.:

~~~
```itinerary
initialDate: 2021-10-21
timeZone: America/Los_Angeles
```
~~~

If you provide the `timeZone` option, all events' displayed times will be shifted to be shown in local time of the timezone you've provided.

#### Event

If your event is occurring far from home, you might want to specify a timezone to interpret the dates/times in:

~~~
```itinerary-event
title: New Years Eve Celebration
start: 2021-12-31T18:00
end: 2022-01-01T04:00
timeZone: America/New_York
```
~~~

When flying any significant horizontal distance around the globe, you're likely to cross some timezone boundaries during a particular event.  If you have events that have differing start/end timezones, you can use the `startTimeZone` and `endTimeZone` options, e.g.:

~~~
```itinerary-event
title: PDX->YUL (AC 8653, AC 308)
start: 2022-08-07T10:30
startTimeZone: America/Los_Angeles
end: 2022-08-07T20:49
endTimeZone: America/Montreal
```
~~~

These specified time zones will be interpreted preferentially over a specified `timeZone` for your event; you probably want to provide either a `timeZone` or a `startTimeZone`/`endTimeZone` pair, though.

### Hiding (or changing) the header toolbar

Maybe you don't want to see the toolbar above your rendered calendar?

~~~
```itinerary
headerToolbar: false
```
~~~

By default, itineraries show the calendar's title on the left and "Today", previous and next buttons on the right.  See https://fullcalendar.io/docs/headerToolbar for how to arrange it differently.

### Ordering calendar events

Perhaps you're printing some types of events on a monthly calendar:

![](http://coddingtonbear-public.s3.amazonaws.com/github/obsidian-itinerary/eventOrderBad.png)

and would rather that the events be displayed in a consistent order based upon the color you set for them:

![](http://coddingtonbear-public.s3.amazonaws.com/github/obsidian-itinerary/eventOrderGood.png)

You can set a sort order for your calendar using the `eventOrder` option:

~~~
```itinerary
eventOrder: start,color
```
~~~

This will suggest to the calendar that you'd like your events ordered first by their start time, and secondarily by their color.  The calendar will ignore this suggestion if it can arrange your calendar more compactly by ignoring this suggestion, though, but you can force it to always use your suggested ordering by using the `eventOrderStrict` option:

~~~
```itinerary
eventOrder: start,color
eventOrderStrict: true
```
~~~

See [FullCalendar's docs](https://fullcalendar.io/docs/eventOrder) covering this for more details.

## Upgrading from version 1

Version 2 of this plugin moves from FullCalendar 5 to FullCalendar 7, which renamed or removed a number of calendar options.  Itineraries you've already written should keep working:

- Options FullCalendar renamed (for example `slotLabelFormat`, now `slotHeaderFormat`, or `eventBackgroundColor`, now `eventColor`) are translated to their new names, and `buttonText` is folded into the new `buttons` option.  Options FullCalendar removed are ignored.  Add `debug: true` to an itinerary to see what was translated.
- The header toolbar is still shown unless you hide it, even though FullCalendar 7 hides it by default.

A few things do behave differently:

- The calendar looks somewhat different, and takes its colors from your Obsidian theme.  Events without a `color` of their own are drawn in the itinerary's `eventColor` if it sets one, or your theme's accent color, instead of always blue.
- An event's `borderColor` now only affects the event summary in your note; FullCalendar 7 draws each event in a single color.
- Renamed options that only make sense with custom CSS (those ending in `ClassNames`), and `nowIndicatorContent` (which FullCalendar 7 split in two), are not translated; see [FullCalendar's upgrade guide](https://fullcalendar.io/docs/upgrading-from-v6).
- An event whose times are all dates (`start: 2021-11-04`, `end: 2021-11-08`, no `allDay`) now counts as all-day in filters, matching how the calendar has always drawn it: `filter: allDay` includes it and `not allDay` leaves it out.
- The summary shown where you wrote an all-day event names the last day the calendar draws it on.  FullCalendar treats an all-day event's `end` as exclusive, so an event ending on November 4th is described as running through November 3rd.
- An event whose `start` and `end` are dates without times is drawn as all-day even when it has a `timeZone`; version 1 drew it as a timed event starting at midnight in that zone.  Add `allDay: false` to keep the old behavior.
- Filters are stricter about types; see "Expressions" above.  In particular, a `start` or `end` written as a number (milliseconds since 1970) is now compared as an ISO date, so a filter comparing it with a number no longer matches.
- The plugin now requires Obsidian 1.13.1 or newer.

## Styling

The calendar takes its colors from your Obsidian theme through FullCalendar's `--fc-classic-*` CSS variables.  To change them with a CSS snippet, set them on `.itinerary-calendar, .itinerary-popover, .itinerary-event` (the popover is the "+N more" list; `.itinerary-event` is an event's summary in your note), e.g. `--fc-classic-today: rgba(255, 200, 0, 0.1)`.

## Development

You'll need Node.js 22 (see `.tool-versions`).

```
npm ci
npm run dev        # rebuild main.js on every change
npm test           # unit tests
npm run lint
npm run typecheck
npm run build      # production build
```

To try a build out, copy `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/obsidian-itinerary/` in a test vault.

## Thanks

This is all built upon the excellent [FullCalendar](https://fullcalendar.io/) javascript library.  If you want to give somebody thanks for the nice rendered calendars, they're the folks who deserve that.
