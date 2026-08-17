// Writing a quiz.
//
// One screen for the whole thing — the quiz's own fields and every question in it — and one save
// that sends all of it. That is the opposite of the story editor, which saves a chapter at a
// time, and the difference is worth stating because it looks inconsistent until you see why: a
// chapter is a megabyte of prose that has to be re-tokenised and re-linked against the lexicon,
// so saving one at a time is what keeps that work bounded. A quiz is a few kilobytes and nothing
// downstream is derived from it. Sending the lot means reordering questions, deleting one from
// the middle and fixing a typo in another are one save rather than three calls that can
// half-succeed. See the note on `quizInput` in the contract.
//
// The draft here is the shape `saveQuiz` takes, near enough, and is deliberately *not* the shape
// the runner reads. A question being written is allowed to be incomplete in ways a question being
// answered is not — no correct option yet, no accepted answer yet — and `unanswerable()` from
// @georgian/shared/quiz is what says so, per question, without refusing the save.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronDown, ChevronUp, Copy, ListChecks, Plus, Trash2, Volume2, X } from 'lucide-react';
import { unanswerable } from '@georgian/shared/quiz';
import type { Quiz, QuizAudio, QuizKind } from '@georgian/shared/types';
import type { QuizAudioClip } from '@georgian/shared/contract';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Breadcrumb, BreadcrumbLink, BreadcrumbSeparator, Page } from '@/components/ui/page';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { KNOW_BUTTON } from '../components/StoryReader';
import { api } from '../api/client';
import { uploadClip } from '../data/quizAudio';
import { lang, langName, quizCategories } from '../content/store';
import {
  ADMIN_INPUT_GEO,
  ADMIN_INPUT_NARROW,
  AdminActions,
  AdminCheck,
  AdminError,
  AdminField,
  AdminGrid,
  AdminHint,
  AdminIconButton,
  AdminInput,
  AdminLabel,
  AdminLinkButton,
  AdminNote,
  AdminPage,
  AdminSection,
  AdminSectionTitle,
  AdminSub,
  AdminTextarea,
  AdminTitle,
  AdminWarning,
} from './ui';
import { useEdit } from './useAdmin';

/** The sentinel the category select uses for "no category", since a Select cannot hold ''. */
const UNFILED = '__none__';

/* ------------------------------------------------------------------- the draft */

interface ChoiceDraft {
  text: string;
  correct: boolean;
  say: string;
  clipId: string | null;
}

interface QuestionDraft {
  kind: QuizKind;
  prompt: string;
  promptNative: string;
  say: string;
  clipId: string | null;
  multiple: boolean;
  /** One per line, for a `type` question. Split on save. */
  answers: string;
  hint: string;
  explanation: string;
  choices: ChoiceDraft[];
}

interface Draft {
  title: string;
  titleNative: string;
  description: string;
  level: string;
  categoryId: string;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  passMark: number;
  askCount: number;
  note: string;
  questions: QuestionDraft[];
}

const BLANK_CHOICE: ChoiceDraft = { text: '', correct: false, say: '', clipId: null };

/** A new question starts as a four-option choice, because that is what most of them are. */
function blankQuestion(): QuestionDraft {
  return {
    kind: 'choice',
    prompt: '',
    promptNative: '',
    say: '',
    clipId: null,
    multiple: false,
    answers: '',
    hint: '',
    explanation: '',
    choices: [{ ...BLANK_CHOICE }, { ...BLANK_CHOICE }, { ...BLANK_CHOICE }, { ...BLANK_CHOICE }],
  };
}

const BLANK: Draft = {
  title: '',
  titleNative: '',
  description: '',
  level: '',
  categoryId: '',
  shuffleQuestions: true,
  shuffleOptions: true,
  passMark: 70,
  askCount: 0,
  note: '',
  questions: [],
};

/** A loaded quiz, as something this screen can edit. The inverse of `toInput` below. */
function toDraft(quiz: Quiz): Draft {
  return {
    title: quiz.title,
    titleNative: quiz.titleNative,
    description: quiz.description,
    level: quiz.level,
    categoryId: quiz.categoryId ?? '',
    shuffleQuestions: quiz.shuffleQuestions,
    shuffleOptions: quiz.shuffleOptions,
    passMark: quiz.passMark,
    askCount: quiz.askCount,
    note: quiz.note,
    questions: quiz.questions.map(question => ({
      kind: question.kind,
      prompt: question.prompt,
      promptNative: question.promptNative,
      say: question.audio.say,
      clipId: question.audio.clipId,
      multiple: question.multiple,
      answers: question.answers.join('\n'),
      hint: question.hint,
      explanation: question.explanation,
      choices: question.choices.map(choice => ({
        text: choice.text,
        correct: choice.correct,
        say: choice.audio.say,
        clipId: choice.audio.clipId,
      })),
    })),
  };
}

/**
 * The draft as `saveQuiz` wants it.
 *
 * A question's `kind` decides what is sent, not what is on screen: switching a question from
 * choice to type leaves its old options in the draft so that switching back does not lose them,
 * and this is where they stop travelling. The server does the same thing again on its side — see
 * the note in `writeQuiz` — because a client is not the place that guarantee can live.
 */
function toInput(draft: Draft) {
  return {
    lang: lang(),
    title: draft.title.trim(),
    titleNative: draft.titleNative.trim(),
    description: draft.description.trim(),
    level: draft.level.trim(),
    categoryId: draft.categoryId || null,
    shuffleQuestions: draft.shuffleQuestions,
    shuffleOptions: draft.shuffleOptions,
    passMark: draft.passMark,
    askCount: draft.askCount,
    note: draft.note.trim(),
    questions: draft.questions.map(question => ({
      kind: question.kind,
      prompt: question.prompt.trim(),
      promptNative: question.promptNative.trim(),
      audio: { say: question.say.trim(), clipId: question.clipId },
      multiple: question.multiple,
      answers:
        question.kind === 'type'
          ? question.answers
              .split('\n')
              .map(line => line.trim())
              .filter(Boolean)
          : [],
      hint: question.hint.trim(),
      explanation: question.explanation.trim(),
      choices:
        question.kind === 'type'
          ? []
          : question.choices.map(choice => ({
              text: choice.text.trim(),
              correct: choice.correct,
              audio: { say: choice.say.trim(), clipId: choice.clipId },
            })),
    })),
  };
}

/**
 * The draft as the marker sees it, so `unanswerable()` can be asked about a question that has
 * never been saved. Positions are the index, which is exactly what the server will write.
 */
function asQuestion(question: QuestionDraft, at: number) {
  const input = toInput({ ...BLANK, questions: [question] }).questions[0];
  return {
    position: at,
    kind: input.kind,
    prompt: input.prompt,
    promptNative: input.promptNative,
    audio: input.audio as QuizAudio,
    multiple: input.multiple,
    answers: input.answers,
    hint: input.hint,
    explanation: input.explanation,
    choices: input.choices.map((choice, position) => ({ ...choice, position, audio: choice.audio as QuizAudio })),
  };
}

/* ------------------------------------------------------------------- the screen */

export default function QuizEditor() {
  const { quizId } = useParams<{ quizId: string }>();
  const navigate = useNavigate();
  const { busy, error, run } = useEdit();
  const categories = quizCategories();

  const [draft, setDraft] = useState<Draft>(BLANK);
  const [loading, setLoading] = useState(Boolean(quizId));
  const [missing, setMissing] = useState(false);
  const [clips, setClips] = useState<QuizAudioClip[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saved, setSaved] = useState(false);

  // The quiz comes from `quiz.get` rather than the snapshot, because the snapshot deliberately
  // carries no questions — see the note on `ContentSnapshot.quizzes`. So this is the one admin
  // screen that fetches what it edits.
  useEffect(() => {
    if (!quizId) return undefined;

    let live = true;
    setLoading(true);

    void api.quiz
      .get({ id: quizId })
      .then(quiz => {
        if (!live) return;
        if (quiz) setDraft(toDraft(quiz));
        else setMissing(true);
        setLoading(false);
      })
      .catch(() => {
        if (!live) return;
        setMissing(true);
        setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [quizId]);

  // The uploaded clips, for every audio field on the page. Fetched once here and handed down
  // rather than per field: a quiz of twenty questions has forty of these.
  useEffect(() => {
    let live = true;
    void api.admin
      .quizAudio()
      .then(answer => {
        if (live) setClips(answer.clips);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft(current => ({ ...current, [key]: value }));

  const setQuestion = (at: number, next: QuestionDraft) =>
    setDraft(current => ({
      ...current,
      questions: current.questions.map((question, index) => (index === at ? next : question)),
    }));

  const moveQuestion = (at: number, by: -1 | 1) =>
    setDraft(current => {
      const to = at + by;
      if (to < 0 || to >= current.questions.length) return current;
      const questions = [...current.questions];
      [questions[at], questions[to]] = [questions[to], questions[at]];
      return { ...current, questions };
    });

  const save = async () => {
    const result = await run(() => api.admin.saveQuiz({ ...(quizId ? { id: quizId } : {}), ...toInput(draft) }));
    if (!result) return;

    setSaved(true);
    if (!quizId) navigate(`/admin/quizzes/${encodeURIComponent(result.id)}`, { replace: true });
  };

  const remove = async () => {
    if (!quizId) return;
    const result = await run(() => api.admin.deleteQuiz({ id: quizId }));
    if (result) navigate('/admin/quizzes', { replace: true });
  };

  if (missing) {
    return (
      <Page>
        <Breadcrumb>
          <BreadcrumbLink to="/admin/quizzes">← Quizzes</BreadcrumbLink>
        </Breadcrumb>
        <p className="py-6 text-center text-muted-foreground">There is no quiz with the id “{quizId}”.</p>
      </Page>
    );
  }

  if (loading) {
    return (
      <Page>
        <p className="py-10 text-center text-muted-foreground">Loading…</p>
      </Page>
    );
  }

  return (
    <AdminPage>
      <Breadcrumb>
        <BreadcrumbLink to="/admin">← Admin</BreadcrumbLink>
        <BreadcrumbSeparator />
        <BreadcrumbLink to="/admin/quizzes">Quizzes</BreadcrumbLink>
        <BreadcrumbSeparator />
        <span>{quizId ? draft.title || quizId : 'New quiz'}</span>
      </Breadcrumb>

      <header className="mb-7">
        <AdminTitle>{quizId ? draft.title || 'Untitled quiz' : 'A new quiz'}</AdminTitle>
        <AdminSub>
          Every question is marked as the reader answers it, with the explanation underneath — so the
          explanation is where the teaching happens, not the score.
        </AdminSub>
      </header>

      {error && <AdminError>{error}</AdminError>}

      <AdminSection>
        <AdminSectionTitle>The quiz</AdminSectionTitle>

        <AdminGrid>
          <AdminField>
            <AdminLabel>Title</AdminLabel>
            <AdminInput
              value={draft.title}
              onChange={event => set('title', event.target.value)}
              placeholder="Present tense endings"
            />
            <AdminHint>A new quiz’s id is slugged from this.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>{langName()} title</AdminLabel>
            <AdminInput
              className={ADMIN_INPUT_GEO}
              value={draft.titleNative}
              onChange={event => set('titleNative', event.target.value)}
              placeholder="Optional"
            />
          </AdminField>

          <AdminField>
            <AdminLabel>Level</AdminLabel>
            <AdminInput
              className={ADMIN_INPUT_NARROW}
              value={draft.level}
              onChange={event => set('level', event.target.value)}
              placeholder="A2"
            />
            <AdminHint>Free text, as a story’s is.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Category</AdminLabel>
            <Select
              value={draft.categoryId || UNFILED}
              onValueChange={value => set('categoryId', value === UNFILED ? '' : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNFILED}>No category</SelectItem>
                {categories.map(category => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                    {category.nameNative ? ` · ${category.nameNative}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AdminHint>
              {categories.length === 0 ? (
                <>
                  There are none yet. <Link to="/admin/quiz-categories">Make one</Link>.
                </>
              ) : (
                <>
                  The heading it is listed under. <Link to="/admin/quiz-categories">Manage categories</Link>.
                </>
              )}
            </AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Pass mark</AdminLabel>
            <AdminInput
              className={ADMIN_INPUT_NARROW}
              type="number"
              min={0}
              max={100}
              value={draft.passMark}
              onChange={event => set('passMark', Math.min(100, Math.max(0, Number(event.target.value) || 0)))}
            />
            <AdminHint>Per cent of the questions. What decides whether a run counts as passed.</AdminHint>
          </AdminField>

          <AdminField>
            <AdminLabel>Questions per run</AdminLabel>
            <AdminInput
              className={ADMIN_INPUT_NARROW}
              type="number"
              min={0}
              max={200}
              value={draft.askCount}
              onChange={event => set('askCount', Math.min(200, Math.max(0, Number(event.target.value) || 0)))}
            />
            <AdminHint>
              {draft.askCount === 0
                ? 'Zero asks every question. Set a number to draw that many at random and leave the rest in the pool — for a drill somebody repeats, where the whole list is too long to sit twice.'
                : draft.askCount >= draft.questions.length
                  ? `Fewer than ${draft.askCount} questions written, so a run asks all ${draft.questions.length}. It will draw ${draft.askCount} once the pool is that big.`
                  : `A run asks ${draft.askCount} of the ${draft.questions.length}, drawn fresh each time. The pass mark is out of ${draft.askCount}.`}
            </AdminHint>
          </AdminField>
        </AdminGrid>

        <AdminField>
          <AdminLabel>Description</AdminLabel>
          <AdminTextarea
            rows={2}
            value={draft.description}
            onChange={event => set('description', event.target.value)}
            placeholder="What this quiz is for. Shown on its card."
          />
        </AdminField>

        <div className="mt-3">
          <AdminCheck>
            <Checkbox
              checked={draft.shuffleQuestions}
              onCheckedChange={value => set('shuffleQuestions', value === true)}
            />
            Ask the questions in a different order each time
          </AdminCheck>

          <AdminCheck>
            <Checkbox checked={draft.shuffleOptions} onCheckedChange={value => set('shuffleOptions', value === true)} />
            Shuffle the options within a question
          </AdminCheck>
          <AdminHint className="-mt-2 mb-3">
            Both worth leaving on: the right answer tends to be the one typed first, and a quiz that
            always rewarded the top option — or that always asked in the order the questions happened
            to be written — would be a quiz about this page rather than about the language. Turn the
            first off for a quiz whose questions build on each other. Ordering questions shuffle their
            word bank regardless — an unshuffled bank would print the answer.
          </AdminHint>
        </div>

        <AdminField>
          <AdminLabel>Note</AdminLabel>
          <AdminTextarea
            rows={2}
            value={draft.note}
            onChange={event => set('note', event.target.value)}
            placeholder="For whoever edits this next. Never shown to readers."
          />
        </AdminField>
      </AdminSection>

      {/* ---- the questions ---- */}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-bold">
          Questions
          <span className="ml-1.5 font-medium text-faint">{draft.questions.length}</span>
        </h2>
        <Button
          variant="control"
          size="auto-sm"
          onClick={() => set('questions', [...draft.questions, blankQuestion()])}
        >
          <Plus /> Add a question
        </Button>
      </div>

      {draft.questions.length === 0 && (
        <AdminNote>
          None yet. A question is one of three things — pick an option, put words in order, or type a
          form — and any of them can be something to <em>listen</em> to instead of read, which is what
          the audio fields are for.
        </AdminNote>
      )}

      {draft.questions.map((question, at) => (
        <QuestionCard
          key={at}
          at={at}
          total={draft.questions.length}
          question={question}
          clips={clips}
          onClips={setClips}
          onChange={next => setQuestion(at, next)}
          onMove={by => moveQuestion(at, by)}
          onRemove={() =>
            set(
              'questions',
              draft.questions.filter((_, index) => index !== at),
            )
          }
        />
      ))}

      {draft.questions.length > 0 && (
        <Button
          variant="control"
          size="auto-sm"
          className="mb-6"
          onClick={() => set('questions', [...draft.questions, blankQuestion()])}
        >
          <Plus /> Add a question
        </Button>
      )}

      {/* ---- saving ---- */}

      <AdminActions>
        <Button
          variant="control"
          size="auto"
          className={KNOW_BUTTON}
          disabled={busy || draft.title.trim() === ''}
          onClick={save}
        >
          <Check /> {busy ? 'Saving…' : quizId ? 'Save the quiz' : 'Create the quiz'}
        </Button>

        {quizId && (
          <Button variant="control" size="auto" asChild>
            <Link to={`/${lang()}/quizzes/${encodeURIComponent(quizId)}`}>
              <ListChecks /> Take it
            </Link>
          </Button>
        )}

        {quizId &&
          (confirmDelete ? (
            <span className="flex flex-wrap items-center gap-2.5 text-sm">
              Delete it? Everybody’s record of having taken it goes too.
              <Button variant="dangerOutline" size="auto-sm" disabled={busy} onClick={remove}>
                Yes, delete
              </Button>
              <Button variant="control" size="auto-sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button variant="dangerOutline" size="auto-sm" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          ))}
      </AdminActions>

      {saved && !busy && !error && (
        <p className="mt-3 flex items-center gap-2 text-[13.5px] text-muted-foreground">
          <Check className="size-4 text-m-5" aria-hidden="true" /> Saved. It is live for readers now.
        </p>
      )}

      {quizId && <EmbedPanel quizId={quizId} />}
    </AdminPage>
  );
}

/* ------------------------------------------------------------------ questions */

const KIND_NAMES: Record<QuizKind, string> = {
  choice: 'Choose an option',
  order: 'Put words in order',
  type: 'Type the answer',
};

const KIND_NOTES: Record<QuizKind, string> = {
  choice:
    'Options, one of which is right. Tick “several answers” to want more than one. Give an option a voice and this becomes “which of these did you hear”.',
  order:
    'A bank of words. Tick the ones that belong in the answer — their order here is the order they have to be put in. Untick a word to leave it in the bank as a distractor.',
  type: 'A field to write in. Every accepted spelling goes on its own line; case, spacing, punctuation and Russian stress marks are all forgiven.',
};

interface QuestionCardProps {
  at: number;
  total: number;
  question: QuestionDraft;
  clips: QuizAudioClip[];
  onClips: (clips: QuizAudioClip[]) => void;
  onChange: (next: QuestionDraft) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

function QuestionCard({ at, total, question, clips, onClips, onChange, onMove, onRemove }: QuestionCardProps) {
  const set = <K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) =>
    onChange({ ...question, [key]: value });

  const setChoice = (index: number, next: ChoiceDraft) =>
    onChange({ ...question, choices: question.choices.map((choice, i) => (i === index ? next : choice)) });

  // Asked of the draft as it stands, on every keystroke. It never blocks the save — a quiz is
  // written over several sittings and a half-finished question is an ordinary thing to leave
  // behind. What it prevents is *not noticing*.
  const problem = useMemo(() => unanswerable(asQuestion(question, at)), [question, at]);

  return (
    <AdminSection>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <AdminSectionTitle className="mb-0">
          Question {at + 1}
          <span className="ml-2 text-[13px] font-medium text-faint">{KIND_NAMES[question.kind]}</span>
        </AdminSectionTitle>

        <div className="flex items-center gap-1.5">
          <AdminIconButton disabled={at === 0} onClick={() => onMove(-1)} aria-label="Move up">
            <ChevronUp className="size-4" />
          </AdminIconButton>
          <AdminIconButton disabled={at === total - 1} onClick={() => onMove(1)} aria-label="Move down">
            <ChevronDown className="size-4" />
          </AdminIconButton>
          <AdminIconButton onClick={onRemove} aria-label="Remove this question">
            <Trash2 className="size-4" />
          </AdminIconButton>
        </div>
      </div>

      <AdminGrid>
        <AdminField>
          <AdminLabel>Kind</AdminLabel>
          <Select value={question.kind} onValueChange={value => set('kind', value as QuizKind)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_NAMES) as QuizKind[]).map(kind => (
                <SelectItem key={kind} value={kind}>
                  {KIND_NAMES[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </AdminField>
      </AdminGrid>

      <AdminHint className="-mt-2 mb-4">{KIND_NOTES[question.kind]}</AdminHint>

      <AdminField>
        <AdminLabel>Instruction</AdminLabel>
        <AdminInput
          value={question.prompt}
          onChange={event => set('prompt', event.target.value)}
          placeholder="Which of these means “wolf”?"
        />
      </AdminField>

      <AdminField className="mt-4">
        <AdminLabel>{langName()} text</AdminLabel>
        <AdminInput
          className={ADMIN_INPUT_GEO}
          value={question.promptNative}
          onChange={event => set('promptNative', event.target.value)}
          placeholder="The material being asked about. Leave empty for a listening question."
        />
      </AdminField>

      <div className="mt-4">
        <AdminLabel>Sound</AdminLabel>
        <AudioField
          audio={{ say: question.say, clipId: question.clipId }}
          clips={clips}
          onClips={onClips}
          onChange={audio => onChange({ ...question, say: audio.say, clipId: audio.clipId })}
        />
        <AdminHint>
          Leave both empty for a question that is only read. A question with sound and no{' '}
          {langName()} text is “what did you hear”.
        </AdminHint>
      </div>

      {question.kind === 'type' ? (
        <AdminField className="mt-4">
          <AdminLabel>Accepted answers</AdminLabel>
          <AdminTextarea
            className={ADMIN_INPUT_GEO}
            rows={3}
            value={question.answers}
            onChange={event => set('answers', event.target.value)}
            placeholder={'One per line.\nThe first is the one shown when somebody gets it wrong.'}
          />
        </AdminField>
      ) : (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <AdminLabel className="mb-0">{question.kind === 'order' ? 'Words' : 'Options'}</AdminLabel>
            {question.kind === 'choice' && (
              <AdminCheck className="my-0 mb-0">
                <Checkbox checked={question.multiple} onCheckedChange={value => set('multiple', value === true)} />
                Several answers
              </AdminCheck>
            )}
          </div>

          <ul className="mb-2 list-none">
            {question.choices.map((choice, index) => (
              <li key={index} className="mb-2 rounded-sm border border-border bg-background p-2.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <AdminCheck className="my-0 mb-0 shrink-0">
                    <Checkbox
                      checked={choice.correct}
                      onCheckedChange={value =>
                        // A single-answer choice question is a radio group wearing checkboxes:
                        // ticking one has to untick the others, or the question becomes
                        // unanswerable in a way the writer did not ask for.
                        question.kind === 'choice' && !question.multiple && value === true
                          ? onChange({
                              ...question,
                              choices: question.choices.map((entry, i) => ({ ...entry, correct: i === index })),
                            })
                          : setChoice(index, { ...choice, correct: value === true })
                      }
                    />
                    {question.kind === 'order' ? 'In the answer' : 'Correct'}
                  </AdminCheck>

                  <AdminInput
                    className={cn(ADMIN_INPUT_GEO, 'min-w-40 flex-1')}
                    value={choice.text}
                    onChange={event => setChoice(index, { ...choice, text: event.target.value })}
                    placeholder={question.kind === 'order' ? 'One word' : 'An option'}
                  />

                  <AdminIconButton
                    onClick={() =>
                      onChange({ ...question, choices: question.choices.filter((_, i) => i !== index) })
                    }
                    aria-label="Remove"
                  >
                    <X className="size-4" />
                  </AdminIconButton>
                </div>

                <div className="mt-2">
                  <AudioField
                    compact
                    audio={{ say: choice.say, clipId: choice.clipId }}
                    clips={clips}
                    onClips={onClips}
                    onChange={audio => setChoice(index, { ...choice, say: audio.say, clipId: audio.clipId })}
                  />
                </div>
              </li>
            ))}
          </ul>

          <Button
            variant="control"
            size="auto-sm"
            onClick={() => onChange({ ...question, choices: [...question.choices, { ...BLANK_CHOICE }] })}
          >
            <Plus /> {question.kind === 'order' ? 'Add a word' : 'Add an option'}
          </Button>

          {question.kind === 'order' && (
            <AdminHint className="mt-2">
              The ticked words, top to bottom, are the answer. Anything unticked stays in the bank as a
              word that does not belong.
            </AdminHint>
          )}
        </div>
      )}

      <AdminGrid className="mt-4 mb-0">
        <AdminField>
          <AdminLabel>Hint</AdminLabel>
          <AdminInput
            value={question.hint}
            onChange={event => set('hint', event.target.value)}
            placeholder="Optional. Offered on request, before answering."
          />
        </AdminField>

        <AdminField>
          <AdminLabel>Explanation</AdminLabel>
          <AdminInput
            value={question.explanation}
            onChange={event => set('explanation', event.target.value)}
            placeholder="Shown after answering, right or wrong."
          />
        </AdminField>
      </AdminGrid>

      {problem && <AdminWarning>{problem}</AdminWarning>}
    </AdminSection>
  );
}

/* ---------------------------------------------------------------------- audio */

/**
 * Where one prompt or one option gets its sound: text for a voice to read, or an uploaded clip.
 *
 * Both are offered because the voices are not good at everything. Typing the text is the quick
 * way and covers most of a quiz; a recording of a real speaker is worth more than any synthesis
 * for the questions that are actually about listening. Whichever is set wins, and when both are
 * the clip does — which is stated on screen rather than left to be discovered.
 */
function AudioField({
  audio,
  clips,
  onClips,
  onChange,
  compact = false,
}: {
  audio: QuizAudio;
  clips: QuizAudioClip[];
  onClips: (clips: QuizAudioClip[]) => void;
  onChange: (next: QuizAudio) => void;
  compact?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const clip = audio.clipId ? clips.find(entry => entry.id === audio.clipId) : undefined;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setFailed(null);
    try {
      const stored = await uploadClip(lang(), file);
      // Refetched rather than pushed on locally, so `uses` is the server's count from the start
      // — the list is what the picker below offers, and a count of "0 uses" on a clip that has
      // one is how somebody deletes something they are still playing.
      const answer = await api.admin.quizAudio();
      onClips(answer.clips);
      onChange({ ...audio, clipId: stored.id });
    } catch (thrown) {
      setFailed(thrown instanceof Error ? thrown.message : 'That file could not be uploaded.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={cn('rounded-sm border border-border bg-card p-2.5', compact && 'bg-transparent p-0 border-0')}>
      <div className="flex flex-wrap items-center gap-2">
        <AdminInput
          className={cn(ADMIN_INPUT_GEO, 'min-w-40 flex-1', Boolean(clip) && 'opacity-45')}
          value={audio.say}
          onChange={event => onChange({ ...audio, say: event.target.value })}
          placeholder={compact ? 'Text to read aloud' : 'Text for a voice to read aloud'}
        />

        <label
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-md border-2 border-border bg-card px-3 py-1.5 text-[13px] font-medium',
            'hover:border-primary hover:bg-control-hover',
            uploading && 'pointer-events-none opacity-45',
          )}
        >
          <Volume2 className="size-3.5" />
          {uploading ? 'Uploading…' : 'Upload'}
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={event => {
              void upload(event.target.files?.[0]);
              // Cleared so that picking the same file again is a change the input reports.
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {clip && (
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <Volume2 className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate font-medium text-foreground">{clip.name || clip.id}</span>
          <span className="text-faint">{Math.round(clip.bytes / 1024)} KB</span>
          <AdminLinkButton onClick={() => onChange({ ...audio, clipId: null })}>Remove</AdminLinkButton>
          {audio.say && <span className="text-faint">— the clip is played, not the text</span>}
        </p>
      )}

      {/* Only when there is something to pick from, and never in place of the upload button: the
          common case is a clip that does not exist yet. */}
      {!clip && clips.length > 0 && (
        <div className="mt-1.5">
          <Select value="" onValueChange={value => onChange({ ...audio, clipId: value })}>
            <SelectTrigger className="h-auto w-full py-1.5 text-[13px]">
              <SelectValue placeholder="…or use a clip already uploaded" />
            </SelectTrigger>
            <SelectContent>
              {clips.map(entry => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name || entry.id} · {Math.round(entry.bytes / 1024)} KB
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {failed && <p className="mt-1.5 text-[12.5px] text-destructive">{failed}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------------- embed */

/**
 * The snippet that puts this quiz on another page.
 *
 * A hash route, and the panel says why in one line rather than making somebody find out: the app
 * routes with `HashRouter`, so `#/embed/quiz/<id>` is served by the index.html the site already
 * serves and needs nothing configured on the web server.
 */
function EmbedPanel({ quizId }: { quizId: string }) {
  const [copied, setCopied] = useState(false);

  const url = `${globalThis.location.origin}${globalThis.location.pathname}#/embed/quiz/${encodeURIComponent(quizId)}`;
  const snippet = `<iframe src="${url}" width="100%" height="560" style="border:0" title="Quiz" loading="lazy"></iframe>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused often enough — an insecure origin, a browser setting — that
      // the textarea below is the real answer and this is the convenience. Failing quietly leaves
      // somebody looking at exactly the text they need to select.
    }
  };

  return (
    <AdminSection className="mt-8">
      <AdminSectionTitle>Putting this quiz on another page</AdminSectionTitle>

      <AdminNote>
        The quiz on its own — no header, no sidebar, and none of the dictionary, so it loads in a
        fraction of what this page does. Add <code>?theme=dark</code> to the URL for a dark host page;
        without it the embed follows the reader’s own system setting.
      </AdminNote>

      <AdminTextarea
        rows={3}
        readOnly
        value={snippet}
        className="font-mono text-[12.5px]"
        onFocus={event => event.target.select()}
      />

      <AdminActions className="mt-3">
        <Button variant="control" size="auto-sm" onClick={copy}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy the snippet'}
        </Button>
        <Button variant="control" size="auto-sm" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer">
            Open it on its own
          </a>
        </Button>
      </AdminActions>

      <AdminWarning>
        An embedded run is never recorded, whoever is watching it. No browser sends the session
        cookie to a third-party iframe, so there is no account behind an embedded quiz to attribute
        anything to — readers who want their runs kept have to take it here, signed in.
      </AdminWarning>
    </AdminSection>
  );
}
