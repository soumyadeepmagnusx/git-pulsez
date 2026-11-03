/**
 * `git stash` / `git commit` arbitraries with the expected `preserve_changes`
 * matcher result (design: "`preserve_changes` matcher for `reset_hard` and
 * `checkout_force`").
 *
 * The expected result is computed from the generator's structured choices:
 * only an explicit `push` or the implied-push shorthand, with the final
 * untracked state enabled (last option wins), only allowed extra options, and
 * no pathspec or partial-stash option, is accepted. No `git commit` form is.
 */

import fc from 'fast-check';
import { arbPermutation } from './gitCommand';
import { arbCommitMessage, arbPath, arbRenderWords, arbSafeText } from './text';

export type StashForm = 'push' | 'implied' | 'plain' | 'save' | 'other_subcommand' | 'commit';

export interface GeneratedStashCommand {
  command: string;
  /** Exact words after `git`, as the tokenizer must produce them. */
  words: string[];
  form: StashForm;
  /** Expected `matchesPreserveChanges` result for the single invocation. */
  accepted: boolean;
}

/** One option element and its effect on the reference model. */
interface StashElement {
  words: string[];
  effect: 'untracked_on' | 'untracked_off' | 'neutral' | 'poison';
}

const arbMessage = arbSafeText({ maxWords: 3 });

const arbUntrackedOn: fc.Arbitrary<StashElement> = fc
  .constantFrom('-u', '--include-untracked', '-a', '--all')
  .map((w) => ({ words: [w], effect: 'untracked_on' as const }));

const arbUntrackedOff: fc.Arbitrary<StashElement> = fc
  .constantFrom('--no-include-untracked', '--no-all')
  .map((w) => ({ words: [w], effect: 'untracked_off' as const }));

const arbNeutral: fc.Arbitrary<StashElement> = fc.oneof(
  fc.constantFrom('-k', '--keep-index', '--no-keep-index', '-q', '--quiet').map((w) => ({ words: [w], effect: 'neutral' as const })),
  arbMessage.map((m) => ({ words: ['-m', m], effect: 'neutral' as const })),
  arbMessage.map((m) => ({ words: [`--message=${m}`], effect: 'neutral' as const })),
  arbMessage.map((m) => ({ words: ['--message', m], effect: 'neutral' as const })),
);

/**
 * Grouped short options from `u`, `a`, `k`, `q`, optionally ending with `m`
 * (message as the next word) or `m<msg>` attached in the same group.
 */
const arbShortGroup: fc.Arbitrary<StashElement> = fc
  .tuple(
    fc.subarray(['u', 'a', 'k', 'q'], { minLength: 1 }).chain((flags) => arbPermutation(flags)),
    fc.constantFrom<'none' | 'next' | 'attached'>('none', 'next', 'attached'),
    fc.constantFrom('wip', 'save work', 'tmp'),
  )
  .map(([flags, msgMode, msg]) => {
    const effect = flags.includes('u') || flags.includes('a') ? ('untracked_on' as const) : ('neutral' as const);
    const group = `-${flags.join('')}`;
    if (msgMode === 'next') return { words: [`${group}m`, msg], effect };
    if (msgMode === 'attached') return { words: [`${group}m${msg.replace(/ /g, '')}`], effect };
    return { words: [group], effect };
  });

const arbPoison: fc.Arbitrary<StashElement> = fc.oneof(
  fc.constantFrom('-p', '--patch', '-S', '--staged', '--index', '--foo').map((w) => ({ words: [w], effect: 'poison' as const })),
  arbPath.map((p) => ({ words: [`--pathspec-from-file=${p}`], effect: 'poison' as const })),
  arbPath.map((p) => ({ words: ['--pathspec-from-file', p], effect: 'poison' as const })),
  arbPath.map((p) => ({ words: ['--', p], effect: 'poison' as const })),
  arbPath.map((p) => ({ words: [p], effect: 'poison' as const })),
  fc.constant({ words: ['-up'], effect: 'poison' as const }),
);

function referenceAccepts(elements: readonly StashElement[]): boolean {
  let untracked = false;
  for (const el of elements) {
    if (el.effect === 'poison') return false;
    if (el.effect === 'untracked_on') untracked = true;
    if (el.effect === 'untracked_off') untracked = false;
  }
  return untracked;
}

function arbElements(poisonWeight: number): fc.Arbitrary<StashElement[]> {
  return fc.array(
    fc.oneof(
      { weight: 4, arbitrary: arbUntrackedOn },
      { weight: 1, arbitrary: arbUntrackedOff },
      { weight: 3, arbitrary: arbNeutral },
      { weight: 2, arbitrary: arbShortGroup },
      { weight: poisonWeight, arbitrary: arbPoison },
    ),
    { minLength: 0, maxLength: 4 },
  );
}

function render(words: string[], form: StashForm, accepted: boolean): fc.Arbitrary<GeneratedStashCommand> {
  return arbRenderWords(['git', ...words]).map((command) => ({ command, words, form, accepted }));
}

/** `git stash push …` with random options. */
const arbExplicitPush: fc.Arbitrary<GeneratedStashCommand> = arbElements(1).chain((els) =>
  render(['stash', 'push', ...els.flatMap((e) => e.words)], 'push', referenceAccepts(els)),
);

/** Implied push `git stash <options>` (first word must be an option). */
const arbImpliedPush: fc.Arbitrary<GeneratedStashCommand> = arbElements(1)
  .filter((els) => els.length > 0 && els[0].words[0].startsWith('-') && els[0].words[0] !== '--')
  .chain((els) => render(['stash', ...els.flatMap((e) => e.words)], 'implied', referenceAccepts(els)));

const arbRejectedOther: fc.Arbitrary<GeneratedStashCommand> = fc.oneof(
  fc.constant(null).chain(() => render(['stash'], 'plain', false)),
  arbElements(0).chain((els) => render(['stash', 'save', ...els.flatMap((e) => e.words)], 'save', false)),
  fc
    .tuple(fc.constantFrom('pop', 'list', 'apply', 'drop', 'clear', 'show', 'branch'), fc.constantFrom<string[]>([], ['-u'], ['--all']))
    .chain(([sub, extra]) => render(['stash', sub, ...extra], 'other_subcommand', false)),
  fc
    .tuple(fc.constantFrom<string[]>(['-m'], ['-am'], ['--all', '-m'], ['-a', '-m'], ['--message']), arbCommitMessage)
    .chain(([opts, msg]) => render(['commit', ...opts, msg], 'commit', false)),
  fc.constantFrom<string[]>(['commit', '--all'], ['commit', '-a'], ['commit']).chain((w) => render(w, 'commit', false)),
);

/** Any stash/commit form, with the expected matcher result. */
export const arbStashCommand: fc.Arbitrary<GeneratedStashCommand> = fc.oneof(
  { weight: 4, arbitrary: arbExplicitPush },
  { weight: 3, arbitrary: arbImpliedPush },
  { weight: 2, arbitrary: arbRejectedOther },
);

/** Stash commands the matcher must accept. */
export const arbAcceptedStashCommand: fc.Arbitrary<GeneratedStashCommand> = fc
  .oneof(arbExplicitPush, arbImpliedPush)
  .filter((c) => c.accepted);

/** Stash/commit commands the matcher must reject (including every `git commit` form). */
export const arbRejectedStashCommand: fc.Arbitrary<GeneratedStashCommand> = arbStashCommand.filter((c) => !c.accepted);
