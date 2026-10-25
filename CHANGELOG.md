# Changelog

Hash LMG has not been released yet. Everything below is on the main branch,
newest first, grouped by what it does for the person making a film.

## Unreleased

### Making films
- The model draws the few things a film is about, from the brief's own
  subject, as line drawings that draw themselves on: a cup for a cafe, a bike
  for a bike service. Each drawing is checked and fitted, or set aside, and
  beats with one take compositions built around it: the picture on a panel
  beside the line, above it, faint behind it, as the name's mark, beside a
  figure or a list. Plain lines gain a band across the frame and a poster.
  A model redesigning the scenes is told the drawings stay, and a scene it
  redesigns without its drawing is put back as the app laid it out.
- Every film is directed from its own brief: a look, an accent colour, a
  tempo and musical key, transitions, entrances, camera moves and a
  composition for each scene, so two briefs, or two takes of one brief, never
  come out alike. Models may suggest a mood, an accent and a tempo.
- Strong models get the moves of the most directed films and a banned list;
  small models write several storyboards and the cleanest is kept.
- Every film is held to what its brief asks to see, measured on the drawn
  film, and what is missing goes back once.
- The film checks catch words crossing words mid-move, a screen frozen for
  more than two beats, and an empty first frame, and repair what they can.
- A carry transition moves one element into the next scene; any layer can be
  repeated by a rule; the Stage look adds a settling ease and figures that
  roll in on an odometer.
- Eight templates make a whole film at once with no model.
- When a model cannot finish redesigning the scenes, the film is still made
  from the rule-made design, with a note saying why.
- Ideas to start from sit under an empty brief, with all of them in a window.
- Generate the Movie and New film live in the top bar; a new film starts
  empty and untitled.

### Your own footage
- Import video, pictures and sound; files stay where they are and are read
  in pieces. A clip or a picture becomes a scene; a song becomes the music.
- Clips have a start point, speed, volume and fit; the timeline's blade
  splits a scene at the playhead; a scene's entrances can be staggered.
- A film made by a model shows the pictures and clips you imported: the
  model is told what each is and which beats may show it, a model that can
  see is shown your pictures, and anything it leaves out is placed on a
  suitable beat. Each is shown whole at its own shape in a thin frame, with
  the beat's words beside or above it; a clip may fill the frame behind its
  words. Your media, and a song chosen as the music, carry over into each
  new film.

### Sound and voice
- The model composes each film's music as code once the film is final: a
  chord progression, a bass line, drums that suit the mood and a melody of
  its own, placed on the film's beats and reveals with the music kit and
  played by the app's instruments. A thin score goes back once; if it still
  fails, the film keeps its built-in score. It can be turned off in
  Settings, and a change that moves the film's timing composes it again.
- Narration in a voice installed on this computer (Chatterbox, Kokoro), a
  local speech server or a cloud voice, timed word by word for captions.
- The score plays in the film's own key and tempo; clips' own sound and
  imported music are mixed under the narration.
- Four played grooves join the three designed scores, chosen by the brief's
  mood: bounce (mallets, claps, a hopping bass), drive (four on the floor, a
  rolling bass, a synth pluck), keys (electric-piano chords, a round bass)
  and arp (a running arpeggio, a held bass, bells). Each film gets a melody
  of its own. A model redesigning the scenes keeps the music chosen from
  the brief; a change asked for in words can still switch it.

### Export
- Encoders built into the app, the same on macOS, Windows and Linux: MP4,
  MOV and GIF at 480p to 4K and 24 to 60 frames a second, a PNG still, and
  the sound alone as WAV or MP3.
- A MOV carries its sound the way QuickTime players read it, so a MOV plays
  with sound on phones and in the system's own player.

### Models
- Before the storyboard, the model may look things up: it names a few
  searches, and pages named in the brief are offered too. Nothing is looked
  up until you say yes to each one; searches use your Tavily key or else
  Wikipedia, pages are read only from public addresses, and a few thousand
  characters of notes go to the storyboard step alone. Settings can turn it
  off.
- A model redesigning a film does it a few scenes at a time: each answer is
  short enough to finish, a part that fails keeps the rule-made scenes it
  covered instead of the whole film losing the model's work, and a fix
  sends only the scenes the checks named. Plans go to the model without
  empty values, and every part starts with the same text, which services
  that cache a request's start read once; long system texts are marked for
  that cache where a service asks to be told.
- Every request's token use is read from the service's reply, listed in the
  run's Markdown record with the run's total, noted when a film is made,
  and written as counts only to `usage.jsonl` for token counters on this
  computer.
- The model is chosen from one list in the director panel: every model that
  can be used now, grouped by service, each list asked of its service when
  the list opens, with a search. Each service remembers the model last
  chosen on it, in the list and in Settings.
- Current cloud models are sent only the settings they accept, with room to
  think; model lists come newest first.
- A model that spends its answer's room on thinking is asked once more with
  room for the thinking, and gets that room for the rest of the session.
- LM Studio, llama.cpp and every cloud service are asked through the desktop
  side, so no server switch is needed, and the app's window reaches no host
  on the internet itself.
- Keys for cloud services are kept by the desktop side, in a file only your
  account can read, and added to each request there; once saved, a key is
  never shown again, only its last four characters. Keys saved by an earlier
  version move there on the next start.
- Local models are sized to what they can read, report their speed and fit,
  and are unloaded once a film is made.

### The editor
- The window can share a small screen with another one: the side panels
  narrow, the timeline gives its empty rows to the preview, and the top bar's
  words take short forms. The top bar holds still while a film is made.
- A step chip, a segmented bar and a panel show each real step of the making,
  with what the model is writing as it arrives.
- Settings has a drawn rail, links to each service's key page with a check,
  a Voice section and a Run history whose runs save as Markdown for debugging.
