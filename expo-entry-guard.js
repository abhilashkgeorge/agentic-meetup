/**
 * You are in the wrong directory.
 *
 * Expo treats any folder with a package.json as a project. The repo root has one --
 * it is an npm workspace root -- so `npx expo run:android` here starts a build,
 * generates a native android/ folder, installs an APK, and only then fails with
 * "Unable to resolve ../../App", because Expo's default entry point expects an
 * App.tsx that has never existed in this repo.
 *
 * That error names a file nobody wrote, in a package nobody edited. This one names
 * the actual problem.
 */
throw new Error(
  [
    '',
    '  Expo was started from the repo root. The app lives in app/.',
    '',
    '    npm run app          start Metro',
    '    npm run android      build and run on Android',
    '    npm run ios          build and run on iOS',
    '',
    '  Or cd app && npx expo start',
    '',
  ].join('\n'),
);
