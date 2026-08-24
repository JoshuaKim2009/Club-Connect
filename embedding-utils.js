// embedding-utils.js

import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

let embedder = null;
let modelLoadingPromise = null;

function loadModel() {
	if (!modelLoadingPromise) {
		modelLoadingPromise = pipeline(
			"feature-extraction",
			"Xenova/all-MiniLM-L6-v2",
			{ dtype: "q8" }
		).then(model => {
			embedder = model;
			return model;
		});
	}
	return modelLoadingPromise;
}

export async function getEmbedding(text) {
	if (!embedder) {
		await loadModel();
	}
	const output = await embedder(text, {
		pooling: "mean",
		normalize: true
	});
	return Array.from(output.data);
}

export function cosineSimilarity(a, b) {
	let dotProduct = 0;
	let magnitudeA = 0;
	let magnitudeB = 0;
	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		magnitudeA += a[i] * a[i];
		magnitudeB += b[i] * b[i];
	}
	magnitudeA = Math.sqrt(magnitudeA);
	magnitudeB = Math.sqrt(magnitudeB);
	return dotProduct / (magnitudeA * magnitudeB);
}

export async function getClubEmbeddings({ description, topics }) {
	const topicString = (topics || []).join(", ");

	const [descriptionEmbedding, topicsEmbedding] = await Promise.all([
		getEmbedding(description || ""),
		getEmbedding(topicString || "")
	]);

	return { descriptionEmbedding, topicsEmbedding };
}

export function warmEmbeddingModel() {
	loadModel();
}