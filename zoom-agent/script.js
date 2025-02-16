// server.js
const express = require("express");
const fetch = require("node-fetch"); // For Node <18. For Node >=18, use the built-in fetch.
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public")); // Serve your frontend (if needed)

// ------------------------
// Helper Functions
// ------------------------

/**
 * Generate a prompt for Luma AI using OpenAI's API.
 * Optionally provide a base prompt to vary.
 */
async function generatePromptForLuma(basePrompt = "A peaceful dynamic nature background") {
  try {
    const response = await fetch("https://api.openai.com/v1/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "text-davinci-003",
        prompt: `${basePrompt} with slight variation`,
        max_tokens: 20,
        temperature: 0.7,
      }),
    });
    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      return data.choices[0].text.trim();
    }
    return basePrompt; // Fallback
  } catch (error) {
    console.error("Error generating prompt from OpenAI:", error);
    return basePrompt;
  }
}

/**
 * Call Luma AI to generate a video from an image.
 * Returns the generation response (which includes an ID).
 */
async function generateVideo(prompt) {
  try {
    const payload = {
      prompt,
      model: "ray-2",
      keyframes: {
        frame0: {
          type: "image",
          // A starting image URL (you may replace this with another appropriate URL)
          url: "https://storage.cdn-luma.com/dream_machine/7e4fe07f-1dfd-4921-bc97-4bcf5adea39a/video_0_thumb.jpg",
        },
      },
    };

    const response = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${process.env.LUMA_AI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error generating video from Luma AI:", error);
    throw error;
  }
}

/**
 * Get the status and details of a generation by its ID.
 */
async function getGeneration(generationId) {
  try {
    const response = await fetch(`https://api.lumalabs.ai/dream-machine/v1/generations/${generationId}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${process.env.LUMA_AI_API_KEY}`,
      },
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error getting generation status:", error);
    throw error;
  }
}

/**
 * Poll the generation until its status is "completed".
 * Assumes the generation response has a property "status" and (when complete) a "video_url".
 */
async function pollGeneration(generationId, interval = 5000) {
  let generation;
  while (true) {
    generation = await getGeneration(generationId);
    console.log(`Generation ${generationId} status: ${generation.status}`);
    if (generation.status === "completed") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return generation;
}

/**
 * Interpolate between two video generations using Luma AI.
 * Returns the new generation response.
 */
async function interpolateVideos(videoId1, videoId2, prompt) {
  try {
    const payload = {
      prompt,
      keyframes: {
        frame0: {
          type: "generation",
          id: videoId1,
        },
        frame1: {
          type: "generation",
          id: videoId2,
        },
      },
    };

    const response = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${process.env.LUMA_AI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error interpolating videos:", error);
    throw error;
  }
}

// ------------------------
// State & Update Logic
// ------------------------

// Store the current background video (ID and URL)
let currentVideo = { id: null, video_url: null };
// Also store the current prompt for reference
let currentPrompt = "A peaceful dynamic nature background";

// Function to start the initial video generation
async function initializeBackground() {
  try {
    // Generate a prompt using OpenAI
    currentPrompt = await generatePromptForLuma(currentPrompt);
    console.log("Initial Luma prompt:", currentPrompt);

    // Generate video from Luma AI
    const genResponse = await generateVideo(currentPrompt);
    console.log("Initial generation response:", genResponse);
    const genId = genResponse.id;
    // Poll until the video is ready
    const generation = await pollGeneration(genId);
    currentVideo = { id: genId, video_url: generation.video_url };
    console.log("Initial video ready:", currentVideo.video_url);
  } catch (error) {
    console.error("Error during initial background generation:", error);
  }
}

// Function to update the background every 20 seconds
async function updateBackground() {
  try {
    // Generate a new prompt with slight variation
    const newPrompt = await generatePromptForLuma(currentPrompt);
    console.log("New prompt for update:", newPrompt);

    // Generate new video using Luma AI
    const newGenResponse = await generateVideo(newPrompt);
    const newGenId = newGenResponse.id;
    const newGeneration = await pollGeneration(newGenId);
    console.log("New video generation ready:", newGeneration.video_url);

    // Now interpolate between the current video and the new video
    const interpResponse = await interpolateVideos(currentVideo.id, newGenId, "Interpolate between current background and new variation");
    const interpGenId = interpResponse.id;
    const interpolatedGeneration = await pollGeneration(interpGenId);
    console.log("Interpolated video ready:", interpolatedGeneration.video_url);

    // Update our current video & prompt for next update
    currentVideo = { id: interpGenId, video_url: interpolatedGeneration.video_url };
    currentPrompt = newPrompt;
  } catch (error) {
    console.error("Error updating background:", error);
  }
}

// Initialize the background on server start
initializeBackground();

// Set an interval to update the background every 20 seconds (20,000 ms)
setInterval(updateBackground, 20000);

// ------------------------
// Endpoints
// ------------------------

/**
 * Endpoint to return the current video URL.
 * Your frontend can poll or use websockets to update the background.
 */
app.get("/api/current-video", (req, res) => {
  if (currentVideo.video_url) {
    res.json({ video_url: currentVideo.video_url });
  } else {
    res.status(503).json({ error: "Video not ready yet" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
