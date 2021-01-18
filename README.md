# HisoonNumber
[Homepage](https://barakplasma.github.io/in-person-queue/client/)

## What is this?
TL:DR; This is a full stack website & server **solution for enabling arbitrary administrators to create location based queues with real-time updates**.

## Inspiration
Due to COVID-19, there is a worldwide effort to provide vaccinations to every person on earth. The vaccines currently available must be administered by medical professionals, typically in non-traditional environments (outdoors in places with enough space to socially distance). People are told to patiently queue up (line up) for their vaccine. **We can do better than forcing people to stand in line in order to get vaccinated.**

Instead, there should be a mobile website for people to keep track of their position in a queue. The mobile website should have real-time updates, should work on any internet-enabled phone, and should respect the user's privacy and data. This project aspires to fulfill this need.

If you'd like to keep reading see "Use cases part II" below

## Use cases part II

The Pfizer-BioNTech COVID-19 Vaccine 💉  has a shelf life of 2-8 hours after a carton of doses has been thawed [[citation]](https://www.fda.gov/media/144413/download). Typically, medical professionals thaw and prepare enough doses for everyone with an appointment. However, not everyone with an appointment is ultimately able to show up to their appointments. Thus, there are typically a  number of leftover vaccine doses which go to waste every day.

**It is better to make leftover and soon-to-expire vaccine doses available to a nearby waiting list of people desiring vaccination than it is to let them go to waste.**

In Israel 🇮🇱 , there has been a grassroots effort to prevent wasting these leftover doses. In practice, people without appointments queue up at vaccination locations at the end of the day in hopes of getting a vaccine dose from a leftover dose. Medical professionals triage the people in the leftover doses queue according to their risk factors, and provide any leftover doses in order of medical need.

The major problem I noticed while waiting in one of these queues is that it's hard to socially distance while trying to sign up on a single paper waiting list. Then, the medical professional needs to shout out names or numbers, which forces people to stay very close together. This project aspires to enable proper social distancing for people in these queues, or even to check on a queue's length before leaving their home.

An intended use case of this project is to enable medical professionals, or the people in the queue themselves, to organize the queue digitally and easily.

## User Guide

[Implemented: Create queue] Navigate to an instance of HisoonNumber, such as https://barakplasma.github.io/in-person-queue/client/ and click on "Create queue at my location". By creating a queue, you gain access to administer that queue.
This prompts the browser to ask permission to do a geolocation check. This geolocation is used to generate an OpenLocationCode, which is used as the name of the queue. Only the queue admin must provide geolocation access. 

[TODO: ADMIN URL]
Anyone with the admin URL can act as an admin. The admin URL for a queue is a secret for controlling the queue.

[TODO: ADMIN MESSAGING] An admin can set and update a queue message / title to "shout" to people waiting in that queue. This is a one-to-many communication channel.

[TODO: SEE NEARBY QUEUES]
People can click "Join a nearby queue" to see a list of nearby queues. 

[Implemented: open existing queue] Alternatively, they can navigate to a queue URL (for example https://barakplasma.github.io/in-person-queue/client/queue.html?location=8G4P3QJJ+56) to join that existing queue.

[TODO: QUEUE STATS] On the queue page, a user can see the current length of the queue. A user can see an estimated waiting time, and the configured capacity of the queue. (it isn't practical to provide an infinite queue with long wait times)

## Deployment / Hosting / Ops
This project is built to be self-hosted. There are no cloud dependencies. You'll need:
* Node.js server (v14 or greater)
* Redis database (v6 or greater)
* domain name or public IP (free dynamic dns is enough)

A $35 Raspberry Pi and a home internet connection can handle a significant amount of traffic, don't be afraid to use one.

[TODO: Docker-compose.yml or setup script]
## Environment Variables
To deploy this, you will need a [.env](https://www.npmjs.com/package/dotenv) file like this or the corresponding environment variables
```env
PORT=3000
REDIS_PORT=6379
REDIS_HOST=localhost
KEY=localhost-key.pem
CERT=localhost-cert.pem
CORS_ORIGIN=https://barakplasma.github.io
```

## Development

## Goals
* The most important goal of this project is to enable an ordinary person to create a vaccine leftover queue extremely quickly and easily.
* This project should stay SIMPLE to use and implement. I want any beginner to be able to fork/hack this project to fit their needs. The only simpler alternative to this project should be a paper and pencil.
* The front end must be **accessible**, fast, and work on almost any MOBILE browser.
* The backend should be easy to self-host, and scale nicely. The backend should be easy to host on a Raspberry Pi, a digital ocean droplet, or a full cluster on EC2 / K8s. This means the backend should be high performance, and simple.
* I respect DevOps, but this project should be NoOps. An operator should ideally be able to set it up on a brand new rasberry pi once and never login to it again. [TODO: Sensible defaults and limits]
* Lighthouse scores above 90 in every category on mobile (currently 94 performance, 91 accessibility, and 100 best practices while connected to the websocket queue)

## Technical Design
Full stack. Vanilla HTML/Javascript/CSS front-end, and Node.js (Socket.io/Express) backend with a Redis datastore.

To enable real-time updates when the queue changes, this project is built on top of WebSockets via Socket.io. For consistancy and ease of development, any client-server communication which could be stuffed into `socket.emit()` was stuffed into `socket.emit()` and `socket.on()`. 

The client website can be hosted as static files ANYWHERE, and this means this shouldn't be a SPA. To be beginner friendly and future proof, this was written without any frameworks, and using the web platform. Additionally, this was **intentionally** built without a bundler, minifier, or any kind of transpilation to reduce complexity and keep this simple to hack on. This comes at the expense of a tiny bit of performance, and that's ok. In my day-to-day, I am a React/Redux developer, and I know very well why I want this to stay simple. The CSS is an afterthought, so I went with MVP.css which was a fantastic choice for speed and accessibility.


#### Keywords / Buzzwords
* WebSockets
* Socket.io
* Redis
* Vanilla.js