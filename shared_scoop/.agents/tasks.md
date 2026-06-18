# SharedScoop: Website to Mobile App Pivot

## The Rules
- **Environment:** React Native with Expo.
- **Do NOT use:** HTML tags (`<div>`, `<span>`), CSS files, `localStorage`, or `react-router-dom`.
- **MUST use:** React Native components (`<View>`, `<Text>`), Flexbox for styling, and `expo-router` for navigation.
- **Strictly Forbidden:** You must read the Firebase configuration and UI logic from the ../old-website directory, but you are strictly forbidden from modifying any files in that directory. All new code must be written exclusively in this mobile-app directory.

## Task 1: Fix the Database Connection
1. Find the incomplete Firebase code from the old website.
2. Update it to work on mobile using `@react-native-async-storage/async-storage` so users stay logged in.
3. Stop and ask me to review the plan.

## Task 2: Build the Mobile Screen
1. Look at the old website UI files to understand the design.
2. Build the main protein listing screen using strictly React Native `<View>` and `<Text>` tags.
3. Add a functional progress bar for the group buy.
4. Stop and ask me to review the plan.

## Task 3: Connect the Data
1. Link the new mobile screen to the fixed Firebase database.
2. Ensure the progress bar updates live as people join the group buy.