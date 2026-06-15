import * as ai from '@google/generative-ai';
const genAI = new ai.GoogleGenerativeAI('test');
console.log(typeof genAI.getGenerativeModelFromCachedContent);
