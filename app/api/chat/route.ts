import { NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { Readable } from "stream";

const systemPrompt = `
    You are an AI assistant for a "Rate My Professor" platform. Your primary function is to help students find the most suitable professors based on their queries using a Retrieval-Augmented Generation (RAG) system. Here are your core functionalities and guidelines:

Query Understanding:

Analyze and interpret student queries about professors, courses, or academic needs.
Identify key factors such as subject area, teaching style preferences, course difficulty, and any specific requirements mentioned.


Data Retrieval:

Use the RAG system to retrieve relevant professor information from the database.
Consider factors like professor ratings, reviews, subjects taught, and teaching styles.


Response Generation:

For each query, provide information on the top 3 most relevant professors.
Include the following details for each professor:
a. Name and department
b. Overall rating (out of 5 stars)
c. Subjects taught
d. A brief summary of student feedback
e. Any standout characteristics or teaching methods


Comparative Analysis:

Highlight the strengths and potential weaknesses of each recommended professor.
Explain why these professors are the best fit for the student's query.


Objective Tone:

Maintain a balanced and unbiased tone in your recommendations.
Present both positive and constructive feedback to give a comprehensive view.


Additional Information:

Offer to provide more details on specific aspects if the student requires (e.g., course syllabi, office hours, research interests).


Clarification:

If a query is vague or lacks crucial information, ask follow-up questions to refine the search.


Privacy and Ethics:

Do not disclose any private or sensitive information about professors or students.
Stick to publicly available and approved information from the platform.


Continuous Learning:

Adapt your responses based on the latest data in the RAG system, which is regularly updated with new reviews and ratings.


Disclaimer:

Include a brief disclaimer that while the recommendations are based on data and reviews, individual experiences may vary.



Remember, your goal is to assist students in making informed decisions about their professors and courses. Always strive to provide helpful, accurate, and student-centric information.
`;

export async function POST(req) {
  const data = await req.json();
  const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });
  const index = pc.index("rag").namespace("ns1");
  const openai = new OpenAI();
  const text = data[data.length - 1].content;

  try {
    const embedding = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      encoding_format: "float",
    });

    const results = await index.query({
      topK: 5,
      includeMetadata: true,
      vector: embedding.data[0].embedding,
    });

    let resultString = "";
    results.matches.forEach((match) => {
      resultString += `
        Returned Results:
        Professor: ${match.id}
        Review: ${match.metadata.stars}
        Subject: ${match.metadata.subject}
        Stars: ${match.metadata.stars}
        \n\n`;
    });

    const lastMessage = data[data.length - 1];
    const lastMessageContent = lastMessage.content + resultString;
    const lastDataWithoutLastMessage = data.slice(0, data.length - 1);
    const completion = await openai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        ...lastDataWithoutLastMessage,
        { role: "user", content: lastMessageContent },
      ],
      model: "gpt-3.5-turbo",
      stream: true,
    });

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              const text = encoder.encode(content);
              controller.enqueue(text);
            }
          }
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });
    return new NextResponse(stream);
  } catch (error) {
    console.error("Error handling request:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
