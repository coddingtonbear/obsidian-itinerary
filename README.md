# Obsidian Itinerary

Planning a vacation or need to otherwise see a set of events on a monthly, weekly, or daily calendar?  If so -- obsidian itinerary can help you keep your plans in order.

## Quickstart

Imaging you have a document outlining what you want to do during an upcoming trip to Mexico; you could try to keep track of things in text like this:

```
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
```

Mostly, though, it's up to your reading ability to keep track of what you have planned for each day, and it's really easy to lose track of things and put yourself into a situation where you forgot to book a hotel one night, or maybe had two conflicting events.

Obsidian Itinerary helps with this by letting you specify events and event calendar displays using a simple format; e.g.:

```
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
    end: 2021-11-04T13:49
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
```

And as a reward for your effort, you can then render calendars for your various plans, e.g:

![](http://coddingtonbear-public.s3.amazonaws.com/github/obsidian-itinerary/overview.png)


## Options

### Itinerary Options

You can specify the following options for displaying your itinerary:

- `source`: A path to a document or a list of paths to documents from which to gather events for display on this calendar.  Defaults to events found in the same file the calendar is rendered.
- `filter`: A list of filter expressions (see "Expressions" below) or a single filter expression to use for limiting which rows of the referenced CSV will be displayed. If unspecified, all events found in the selected sources will be included.
- `debug`: Will cause some debugging information to be printed below your rendered itinerary.

In addition to the above, you can provide any options described here: https://fullcalendar.io/docs; particularly useful properties include:

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
- `end`: An ISO timestamp representing your event's end time.
- `tag`: A single string tag or list of tags to associate with this event.  These are useful for specifically marking things like flights or hotel stays so you can generate calendars showing only one kind of event.

Additionally, you can provide any options described here:  https://fullcalendar.io/docs/event-parsing; particularly useful properties include:

- `color`: For marking your events in a particular color
- `allDay`: For marking your event as an "all-day" event.

### Expressions

This library uses `filtrex` for expression evaluation; see their documentation to see more information about the expression syntax and what functions are available: https://github.com/m93a/filtrex#expressions.

See "Filtering displayed rows" for an example of a filter expression in action, but realistically they work exactly as you'd probably expect.

## Tips

### Rendering information for a single day

Say that you have a particularly complicated day that you'd like to render to make sure you've left yourself enough time between things:

```itinerary
initialDate: 2021-11-01
initialView: listDay
```

![](http://coddingtonbear-public.s3.amazonaws.com/github/obsidian-itinerary/listDay.png)

Try using `timeGridDay`, too!

### Filtering events based upon tag

You can filter events based upon what tags are available easily, for example:

```itinerary
filter:
- '"hotel" in tag'
```

or 

```itinerary
filter:
- '"hotel" not in tag'
```

Note that the single quotes surrounding the whole expression are necessary given that this is a YAML document, and YAML documents have some parsing rules that make this just slightly awkward.

### Hiding (or changing) the header toolbar

Maybe you don't want to see the toolbar above your rendered calendar?

```itinerary
headerToolbar:
```

See https://fullcalendar.io/docs/headerToolbar for more information.

## Thanks

This is all built upon the excellent [FullCalendar](https://fullcalendar.io/) javascript library.  If you want to give sombody thanks for the nice rendered calendars, they're the folks who deserve that.
