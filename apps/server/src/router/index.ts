import { contentRouter } from './content.ts';
import { studyRouter } from './study.ts';
import { os } from './base.ts';

export const router = os.router({
  content: contentRouter,
  study: studyRouter,
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
        email: user.email,
        image: user.image ?? null,
      };
    }),
  }),
});

export type AppRouter = typeof router;
