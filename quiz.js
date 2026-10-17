import 'dotenv/config';
import OpenAI from 'openai';
import { QUESTION_BANK, TOPICS } from './questions.js';

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
const model = process.env.OPENAI_MODEL || 'gpt-5.5';
const RANDOM_TOPIC_LABELS = new Set(['aleatorio', 'cualquier tema', 'random', 'any topic']);
const META_TOPICS = new Set(['aleatorio', 'cualquier tema', 'tema personalizado']);

export const isAiEnabled = Boolean(openai);

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function resolveTopic(topic) {
  const requested = String(topic || 'Cultura general').trim() || 'Cultura general';
  if (RANDOM_TOPIC_LABELS.has(requested.toLocaleLowerCase('es'))) {
    const available = TOPICS.filter((item) => !META_TOPICS.has(item.toLocaleLowerCase('es')));
    return pickRandom(available);
  }
  return requested;
}

function historyQuestion(entry) {
  return typeof entry === 'string' ? entry : String(entry?.question || '');
}
function historyAnswer(entry) {
  return typeof entry === 'string' ? '' : String(entry?.answer || '');
}

function normalizeAnswer(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function localGrade(question, submittedAnswer) {
  const submitted = normalizeAnswer(submittedAnswer);
  const candidates = [question.answer, ...(question.acceptedAnswers || [])]
    .map(normalizeAnswer)
    .filter(Boolean);

  if (!submitted) return { correct: false, feedback: 'Escribe una respuesta para poder valorarla.' };
  for (const expected of candidates) {
    if (submitted === expected) return { correct: true, feedback: 'Respuesta correcta.' };
    if (expected.length >= 5 && submitted.length >= 5) {
      if (submitted.includes(expected) || expected.includes(submitted)) {
        const shorter = Math.min(submitted.length, expected.length);
        const longer = Math.max(submitted.length, expected.length);
        if (shorter / longer >= 0.72) return { correct: true, feedback: 'Respuesta correcta.' };
      }
      const distance = levenshtein(submitted, expected);
      const similarity = 1 - distance / Math.max(submitted.length, expected.length);
      if (similarity >= 0.91 && Math.min(submitted.length, expected.length) >= 5) {
        return { correct: true, feedback: 'Respuesta correcta.' };
      }
    }
  }
  return { correct: false, feedback: 'La respuesta no coincide con la solución aceptada.' };
}

function questionWasAsked(questionText, recentQuestionTexts = []) {
  const normalized = normalizeAnswer(questionText);
  if (!normalized) return true;
  const tokens = (value) => new Set(normalizeAnswer(value).split(' ').filter((word) => word.length > 2 && ![
    'que', 'cual', 'cuales', 'como', 'donde', 'cuando', 'quien', 'quienes', 'para', 'entre', 'sobre', 'este', 'esta', 'estos', 'estas', 'desde', 'segun', 'principalmente', 'llama', 'nombre', 'tipo', 'ocurrio', 'ocurre', 'asocia', 'caracteristica',
  ].includes(word)));
  const candidateTokens = tokens(normalized);
  return recentQuestionTexts.some((entry) => {
    const previous = normalizeAnswer(historyQuestion(entry));
    if (!previous) return false;
    if (previous === normalized) return true;
    // Reject near-identical paraphrases without banning unrelated questions that share a common answer.
    const previousTokens = tokens(previous);
    const shared = [...candidateTokens].filter((word) => previousTokens.has(word)).length;
    const union = new Set([...candidateTokens, ...previousTokens]).size || 1;
    const jaccard = shared / union;
    if (Math.min(candidateTokens.size, previousTokens.size) >= 4 && jaccard >= 0.82) return true;
    if (Math.min(normalized.length, previous.length) >= 28) {
      const distance = levenshtein(normalized, previous);
      const similarity = 1 - distance / Math.max(normalized.length, previous.length);
      if (similarity >= 0.88) return true;
    }
    return false;
  });
}

function bankQuestion(topic, recentQuestionTexts = []) {
  const effectiveTopic = resolveTopic(topic);
  const recent = new Set(recentQuestionTexts.map((entry) => normalizeAnswer(historyQuestion(entry))));
  let candidates = QUESTION_BANK.filter((q) => q.topic.toLocaleLowerCase('es') === effectiveTopic.toLocaleLowerCase('es'));

  // Para temas personalizados sin IA, busca palabras relevantes en tema, pregunta y solución.
  if (!candidates.length && !TOPICS.some((t) => t.toLocaleLowerCase('es') === effectiveTopic.toLocaleLowerCase('es'))) {
    const words = normalizeAnswer(effectiveTopic).split(' ').filter((word) => word.length >= 4);
    candidates = QUESTION_BANK.filter((q) => words.some((word) =>
      normalizeAnswer(`${q.topic} ${q.question} ${q.answer}`).includes(word)));
  }
  if (!candidates.length) candidates = QUESTION_BANK.filter((q) => q.topic === 'Cultura general');

  // No repetir ninguna pregunta del banco hasta agotar las disponibles para ese tema.
  const fresh = candidates.filter((q) => !recent.has(normalizeAnswer(q.question)));
  const selected = pickRandom(fresh.length ? fresh : candidates);
  return { ...selected, source: 'bank' };
}

function safeJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

function recentContext(history, extraRejected = []) {
  return [
    ...history.slice(-120).map((entry) => ({
      pregunta: historyQuestion(entry),
      ...(historyAnswer(entry) ? { respuesta: historyAnswer(entry) } : {}),
      ...(typeof entry === 'object' && entry?.topic ? { tema: entry.topic } : {}),
    })),
    ...extraRejected.map((question) => ({ pregunta_rechazada_por_repetida: question })),
  ];
}

async function askAIForQuestion(topic, history, rejectedQuestions) {
  const response = await openai.responses.create({
    model,
    instructions: [
      'Eres el generador de preguntas de un juego competitivo de conocimiento en español.',
      'Crea exactamente una pregunta clara, verificable y con una respuesta factual estable.',
      'Respeta estrictamente la temática solicitada. Si el tema es una asignatura concreta, no te desvíes a cultura general.',
      'Evita política y noticias recientes salvo petición expresa. No hagas preguntas ambiguas ni de opinión, y no reveles la respuesta en el enunciado.',
      'Incluye una respuesta canónica, entre 3 y 8 variantes o alias válidos cuando existan y una explicación breve.',
      'MUY IMPORTANTE: no repitas ninguna pregunta de la lista de preguntas recientes y no reformules la misma pregunta factual. Cambia el hecho concreto que se evalúa; no basta con cambiar unas pocas palabras.',
      'Si no encuentras una pregunta distinta, elige otro subtema dentro de la temática en lugar de repetir.',
      'Devuelve solamente un objeto JSON con las claves: question, answer, acceptedAnswers (array de strings), explanation, topic.',
    ].join(' '),
    input: JSON.stringify({
      tema_solicitado: topic,
      preguntas_y_respuestas_recientes_a_evitar: recentContext(history, rejectedQuestions),
    }),
    text: { format: { type: 'json_object' } },
  });
  const parsed = safeJson(response.output_text);
  if (
    typeof parsed.question !== 'string' || parsed.question.trim().length <= 8 ||
    typeof parsed.answer !== 'string' || !parsed.answer.trim() ||
    !Array.isArray(parsed.acceptedAnswers)
  ) throw new Error('La respuesta de la IA no tenía el formato esperado.');

  return {
    question: parsed.question.trim(),
    answer: parsed.answer.trim(),
    acceptedAnswers: parsed.acceptedAnswers.filter((x) => typeof x === 'string').slice(0, 12),
    explanation: typeof parsed.explanation === 'string' ? parsed.explanation.trim() : '',
    topic: typeof parsed.topic === 'string' && parsed.topic.trim() ? parsed.topic.trim() : topic,
    source: 'ai',
  };
}

export async function generateQuestion(topic, recentQuestionTexts = []) {
  const effectiveTopic = resolveTopic(topic);
  if (openai) {
    const rejectedQuestions = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const parsed = await askAIForQuestion(effectiveTopic, recentQuestionTexts, rejectedQuestions);
        if (!questionWasAsked(parsed.question, [...recentQuestionTexts, ...rejectedQuestions])) return parsed;
        rejectedQuestions.push(parsed.question);
        console.warn('La IA propuso una pregunta repetida; se solicita otra.');
      } catch (error) {
        console.error('Falló la generación de pregunta por IA; se usa el banco local:', error.message);
        break;
      }
    }
    if (rejectedQuestions.length) {
      console.warn('La IA no consiguió proponer una pregunta nueva; se usa una pregunta inédita del banco local cuando quede disponible.');
    }
  }
  return bankQuestion(effectiveTopic, recentQuestionTexts);
}

export async function gradeAnswer(question, submittedAnswer) {
  if (!openai) return localGrade(question, submittedAnswer);
  try {
    const response = await openai.responses.create({
      model,
      instructions: [
        'Eres un árbitro estricto pero justo para un juego de preguntas en español.',
        'Decide si la respuesta del jugador demuestra que sabe la respuesta. Acepta sinónimos, nombres alternativos, abreviaturas habituales, pequeños errores ortográficos y formulaciones equivalentes.',
        'No aceptes una respuesta vaga, contradictoria o meramente relacionada con el tema. Si hay dos interpretaciones razonables o falta información esencial, marca incorrecta.',
        'Evalúa solo el contenido, no la gramática ni las tildes. Usa la solución de referencia como guía, no exijas las mismas palabras.',
        'Devuelve únicamente JSON con las claves correct (boolean) y feedback (frase breve en español). No incluyas la solución en feedback.',
      ].join(' '),
      input: JSON.stringify({
        pregunta: question.question,
        respuesta_de_referencia: question.answer,
        respuestas_alternativas_aceptadas: question.acceptedAnswers || [],
        respuesta_del_jugador: String(submittedAnswer).slice(0, 500),
      }),
      text: { format: { type: 'json_object' } },
    });
    const parsed = safeJson(response.output_text);
    if (typeof parsed.correct !== 'boolean') throw new Error('La IA no devolvió un booleano correct.');
    return {
      correct: parsed.correct,
      feedback: typeof parsed.feedback === 'string' ? parsed.feedback.slice(0, 180) : (parsed.correct ? 'Respuesta correcta.' : 'Respuesta incorrecta.'),
    };
  } catch (error) {
    console.error('Falló la corrección por IA; se usa comparación local:', error.message);
    return localGrade(question, submittedAnswer);
  }
}
