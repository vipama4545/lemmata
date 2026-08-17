import { adminRouter } from './admin.ts';
import { contentRouter } from './content.ts';
import { libraryRouter } from './library.ts';
import { quizRouter } from './quiz.ts';
import { studyRouter } from './study.ts';
import { os } from './base.ts';

export const router = os.router({
  content: contentRouter,
  study: studyRouter,
  quiz: quizRouter,
  // A reader's own stories and words. Beside `admin` rather than under `content`, because what
  // it writes is content and what decides whether it may is *ownership* — see library.ts.
  library: libraryRouter,
  admin: adminRouter,
  session: os.session.router({
    /**
     * Who you are. The web app asks once at boot and again after a sign-in redirect; there
     * is no client-side decoding of the session cookie anywhere, which is why it is
     * httpOnly.
     */
    me: os.session.me.handler(({ context }) => {
      const user = context.session?.user;
      if (!user) return null;
      return {
        id: user.id,
        name: user.name,
        // In full, and only ever to its owner: this is the signed-in user's own address, and
        // saying which account you are in is the whole job of the line that shows it.
        //
        // It is the only address this server ever sends anywhere. Nobody else's appears in
        // any response — `admin.users`, the one screen listing other people, does not select
        // the column at all.
        email: user.email,
        image: user.image ?? null,
        // Better Auth carries the additional fields through on the session user, but types
        // them loosely enough that this needs saying. It is only what the app paints with;
        // the procedures under `admin` re-read the column rather than trusting it.
        isAdmin: (user as { isAdmin?: boolean }).isAdmin === true,
      };
    }),
  }),
});

export type AppRouter = typeof router;
