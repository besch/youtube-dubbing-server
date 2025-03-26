I have two folders "mobile" and "server". I already created nextjs project and react-native project.

We're gonna create mobile app that uses react-native and expo to create a youtube dubbing app. Server using nextjs and supabase.

server api key:
process.env.OPENAI_API_KEY
process.env.REPLICATE_API_KEY
process.env.NEXT_PUBLIC_SUPABASE_URL
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
process.env.SUPABASE_SERVICE_ROLE_KEY

steps:
user copies youtube video url and pastes it in the app, chooses language and voice to watch video with.

available voices:
| "alloy"
| "echo"
| "fable"
| "onyx"
| "nova"
| "shimmer"

app sends the url to the server where I want to use yt-dlp(I have a premium vercel account so Vercel functions can run up to 15 minutes)
yt-dlp downloads the video, then use:
"
import Replicate from "replicate";

const replicate = new Replicate({
auth: process.env.REPLICATE_API_TOKEN,
});

const output = await replicate.run(
"thomasmol/whisper-diarization:d8bc5908738ebd84a9bb7d77d94b9c5e5a3d867886791d7171ddb60455b4c6af",
{
input: {
file: "https://replicate.delivery/pbxt/JcL0ttZLlbchC0tL9ZtB20phzeXCSuMm0EJNdLYElgILoZci/AI%20should%20be%20open-sourced.mp3",
prompt: "LLama, AI, Meta.",
file_url: "",
language: "en",
translate: false,
num_speakers: 2
}
}
);
console.log(output);
"

replicate example response:
"
{
"end": 4.48,
"text": "Let me ask you about AI.",
"start": 2.94,
"words": [
{
"end": 3.12,
"word": " Let",
"start": 2.94,
"speaker": "SPEAKER_01",
"probability": 0.69384765625
},
{
"end": 3.26,
"word": " me",
"start": 3.12,
"speaker": "SPEAKER_01",
"probability": 0.9990234375
},
{
"end": 3.74,
"word": " ask",
"start": 3.26,
"speaker": "SPEAKER_01",
"probability": 0.998046875
},
{
"end": 3.86,
"word": " you",
"start": 3.74,
"speaker": "SPEAKER_01",
"probability": 0.99267578125
},
{
"end": 4.1,
"word": " about",
"start": 3.86,
"speaker": "SPEAKER_01",
"probability": 0.9990234375
},
{
"end": 4.48,
"word": " AI.",
"start": 4.1,
"speaker": "SPEAKER_01",
"probability": 0.966796875
}
],
"speaker": "SPEAKER_01",
"duration": 1.5400000000000005,
"avg_logprob": -0.17278645634651185
}
"

to transcribe audio and diarize speakers.

in the app user can start watch youtube video while app make requests to server to generate audio with openai.
audio should be generated 5 seconds before audio suppose to start(track video player time)

"const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY,
});

const mp3 = await openai.audio.speech.create({
model: "tts-1",
voice: voice,
input: text,
});
"

if youtube video length is more than 5 minutes, transcribe audio in chunks of 5 minutes,
when user e.g. watched 3.5 minutes, start to transcribe next chunk.
you can save chunks to supabase storage, and remove them after 24 hours.
make config file, I want those values to be configurable.
make this app efficient regarding resources and costs.I
app ux/ui should be simple and clean, impeccable and very easy to use.
app should work properly on all android and ios devices.
in app settings user should be able to choose language and voice.
if e.g. diarization output with have e.g. two speakers, e.g. male and female, I want to generate audio accordingly
make code modular and reusable. I might want to replace openai tts with azure tts in the future(add azure tts, but dont use it)
user should be able to see watched history.
user should be able to to add video to favorites. if added to favorites keep generated audio files for 30 days along with transcriptions.
give me a complete schema.sql file for supabase.
think about edge cases that I forget to mention.
now complete all tasks above till the end.
