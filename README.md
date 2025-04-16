# AI-Voice-Tutor-for-Personalized-Learning
The Problem
In traditional education systems, students often:
Feel shy to ask doubts repeatedly.
Struggle to get instant help outside classroom hours.
Require personalized explanations based on their level of understanding.
Find static content (like books or PDFs) overwhelming or hard to grasp without context.
Many students, especially in rural or underserved regions, lack access to human tutors, and often rely on reading material that isn’t interactive or responsive.
Objective
To design and implement a low-latency AI Voice Assistant pipeline that:
Accepts voice input from users
Converts speech to text
Uses a Large Language Model (LLM) to generate a response
Converts the response back into speech
Uses a talking avatar to deliver the response
Technologies and Services Used
Frontend:
HTML
CSS
JavaScript
Backend Services and APIs:
Azure Speech-to-Text API
Azure OpenAI Service (GPT model)
Azure Text-to-Speech (TTS)
Flask (Python backend to connect APIs)
GitHub for version control
Avatar and UI:
D-ID API for lip-synced avatar animation
Web interface built using HTML, CSS, and JavaScript
Step-by-Step Implementation
Step 1: Voice Input Capture
A simple web interface is created using HTML and JavaScript.
The user presses a microphone button to start recording.
The browser uses MediaRecorder to record audio and save it in WAV format.
Step 2: Speech-to-Text Conversion
The recorded voice is sent to Azure’s Speech-to-Text API.
The API converts spoken language into text using pre-trained models.
The response is a string containing the user’s query.
Step 3: Processing with LLM (Azure OpenAI GPT)
The converted text is sent to Azure OpenAI’s GPT endpoint.
The prompt is structured to limit the response to two clear and concise sentences.
Example prompt:
"Explain the following query in two simple sentences: 'What is Newton's third law?'"
Step 4: Text-to-Speech (Azure TTS)
The generated response is sent to Azure’s Text-to-Speech API.
Parameters such as pitch, voice gender (male/female), and speed can be configured.
The output is an audio file (MP3 or WAV) with the spoken response.
Step 5: Talking Avatar Animation
The response text and audio file are sent to the D-ID API.
D-ID animates a virtual human avatar that lip-syncs with the voice.
The generated video is embedded in the frontend and played automatically.
Step 6: Display and Interaction
The web application displays the video to the user.
The student hears the answer and sees the avatar speaking, enhancing understanding and engagement.
The user can ask another question or end the session.
Conclusion
This AI voice assistant demonstrates how speech technologies and large language models can be combined to build intelligent, interactive learning platforms. By integrating Azure services with web technologies, we created a pipeline that is scalable, customizable, and highly beneficial for personalized learning.
