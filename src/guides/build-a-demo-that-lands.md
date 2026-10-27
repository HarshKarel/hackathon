---
key: demo
---
Judges usually see your project for a few minutes, often after seeing many others. In that time they need to understand what it does, believe that it works and remember it afterwards. A demo that lands does all three. It does not need to show everything you built.

## Choose one path and make it bulletproof

Pick the single journey that shows the value of your project: a person arrives with a problem, does a few things, and leaves with it solved. That is your demo path.

- Make every step on that path work every time, on the machine you will present from.
- Use realistic sample data that tells a story. "Priya uploads last month's invoices" is easier to follow than "test user 3 uploads file.csv".
- Remove anything from the screen that does not support the path: debug panels, unfinished menus, placeholder text.

Breadth is tempting, but a judge cannot tell the difference between five half-working features and five broken ones.

## Show the result early

Open with the moment that makes people lean in: the output, the before and after, the thing that surprised you while building. Then explain how you got there. If the first thirty seconds are login screens and setup, you have lost part of the room.

## Make it real, and say what is not

Working software is persuasive in a way slides are not. Judges at many events score technical execution or functionality directly, and a live product is the clearest evidence.

Be honest about the parts that are simulated. "The bank connection is mocked for the demo; the categorisation runs live on these transactions" builds more trust than letting a judge discover it in questions. Hard-coding a step is common at hackathons; hiding it is what hurts.

## Remove the risks you can control

Live demos fail for boring reasons. Plan for them:

- **Network.** Venue Wi-Fi is often slow. Run locally where you can, or have a phone hotspot ready.
- **External services.** If an API might rate limit you, cache the responses you need for the demo.
- **Accounts and sessions.** Log in before you start. Make sure tokens will not expire mid-demo.
- **The screen.** Test on the projector or screen-share you will actually use. Increase font sizes and zoom the browser.
- **A fallback.** Have a recorded video of the demo ready to play if the live version fails.

## Record the demo video

Most online events, and many in-person ones, ask for a demo video with the submission. It is often the only thing a judge sees before deciding which projects get a closer look.

- **Follow the platform rules.** On Devpost, the video must be public on YouTube or Vimeo so it embeds for judges, and each event's rules may set a maximum length. Devfolio's submission form asks for a demo video, with YouTube preferred.
- **Show the product, not the team.** Spend most of the time on screen recordings of the real thing.
- **Narrate clearly.** Say what the viewer is looking at and why it matters.
- **Keep it short.** If there is no limit, shorter is still better. Cut every second that does not help.
- **Check it plays.** After uploading, open the link in a private browser window and confirm it is public.

## Make the project easy to judge after the demo

Judges often revisit projects later, from the submission page.

- Write a clear first paragraph: who it is for, what it does, what is impressive about it.
- List the technologies used, especially any sponsor tools that make you eligible for their prizes.
- Add screenshots, with the most important one first.
- Link a repository with a short README that explains how to run it and what works.

## Rehearse with the clock running

Run the demo exactly as you will present it, including switching windows and speaking, at least twice. Time it. Decide who drives the computer and who talks, and agree what happens if something breaks: the presenter keeps talking while the driver switches to the backup video.

## A last check before you present

- The demo path works from a fresh start.
- Sample data is loaded and makes sense.
- Notifications, other apps and personal tabs are closed.
- The backup video is open and ready.
- Everyone knows their part.

Then read [how to pitch to judges](/guides/pitch-to-judges/) to wrap the demo in a clear story.
