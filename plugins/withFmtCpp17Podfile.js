/**
 * the fix to inject to pod file - issue when migrating to react-native 0.83.4 and expo 55
 * Expo config plugin: rewrites the generated iOS `Podfile` during `expo prebuild`.
 *
 * Why this exists: `ios/Podfile` is regenerated on each prebuild, so manual edits are lost.
 * This plugin injects the same patches automatically so the team does not maintain a forked template.
 *
 * Problems it addresses:
 * - react-native-iap needs the `RCT-Folly` CocoaPods target; Expo’s prebuilt RN deps (`RCT_USE_RN_DEP=1`)
 *   do not expose that pod — we set `RCT_USE_RN_DEP=0` and reorder so `use_react_native!` runs before
 *   `use_native_modules!`, letting Folly register before autolinking.
 * - Xcode 26 toolchain: disable explicit Swift modules on pods + app (SwiftUICore / RCTSwiftUI issues),
 *   build `fmt` as C++17, bump iOS deployment target floor to 12.0, link SwiftUI and zlib for MMKV crc32.
 *
 * Injected sections are marked with `# @generated begin ...` / `# @generated end ...` for review.
 *
 * Patch summary (what the plugin does):
 * 1. RCT_USE_RN_DEP=0 so react-native-iap can resolve RCT-Folly (prebuilt RN omits standalone pod).
 * 2. Reorder: use_react_native! before use_native_modules! (RCT-Folly registered before autolinking).
 * 3. post_install: Xcode 26 — SWIFT_ENABLE_EXPLICIT_MODULES=NO on pods + app targets (SwiftUICore); fmt as C++17; deployment floor 12.0.
 */
const { withPodfile } = require('expo/config-plugins');

const EXPO_REORDER_FROM = `  config = use_native_modules!(config_command)

  use_frameworks! :linkage => podfile_properties['ios.useFrameworks'].to_sym if podfile_properties['ios.useFrameworks']
  use_frameworks! :linkage => ENV['USE_FRAMEWORKS'].to_sym if ENV['USE_FRAMEWORKS']

  use_react_native!(
    :path => config[:reactNativePath],
    :hermes_enabled => podfile_properties['expo.jsEngine'] == nil || podfile_properties['expo.jsEngine'] == 'hermes',
    # An absolute path to your application root.
    :app_path => "#{Pod::Config.instance.installation_root}/..",
    :privacy_file_aggregation_enabled => podfile_properties['apple.privacyManifestAggregationEnabled'] != 'false',
  )

  post_install do |installer|`;

const EXPO_REORDER_TO = `  use_frameworks! :linkage => podfile_properties['ios.useFrameworks'].to_sym if podfile_properties['ios.useFrameworks']
  use_frameworks! :linkage => ENV['USE_FRAMEWORKS'].to_sym if ENV['USE_FRAMEWORKS']

  use_react_native!(
    :path => '../node_modules/react-native',
    :hermes_enabled => podfile_properties['expo.jsEngine'] == nil || podfile_properties['expo.jsEngine'] == 'hermes',
    # An absolute path to your application root.
    :app_path => "#{Pod::Config.instance.installation_root}/..",
    :privacy_file_aggregation_enabled => podfile_properties['apple.privacyManifestAggregationEnabled'] != 'false',
  )

  config = use_native_modules!(config_command)

  post_install do |installer|`;

const RCT_FOLLY_BEGIN = '# @generated begin expo-rn-deps-rct-folly';
const RCT_FOLLY_END = '# @generated end expo-rn-deps-rct-folly';
const RCT_FOLLY_SNIPPET = `

${RCT_FOLLY_BEGIN}
# react-native-iap (New Arch) depends on pod \`RCT-Folly\`. Prebuilt RN deps (RCT_USE_RN_DEP=1) use
# ReactNativeDependencies only — no standalone RCT-Folly pod — so CocoaPods cannot satisfy RNIap.
ENV['RCT_USE_RN_DEP'] = '0'
${RCT_FOLLY_END}
`;

function injectRctFollyWorkaround(contents) {
  if (contents.includes(RCT_FOLLY_BEGIN)) {
    return contents;
  }
  const anchor = "podfile_properties = JSON.parse(File.read(File.join(__dir__, 'Podfile.properties.json'))) rescue {}";
  const idx = contents.indexOf(anchor);
  if (idx === -1) {
    console.warn('[withFmtCpp17Podfile] Could not inject RCT-Folly workaround (podfile_properties anchor missing).');
    return contents;
  }
  const insertAt = idx + anchor.length;
  return contents.slice(0, insertAt) + RCT_FOLLY_SNIPPET + contents.slice(insertAt);
}

function reorderPodfile(contents) {
  if (
    contents.includes(":path => '../node_modules/react-native'") &&
    contents.indexOf('use_react_native!') !== -1 &&
    contents.indexOf('use_react_native!') < contents.indexOf('config = use_native_modules!(config_command)')
  ) {
    return contents;
  }
  if (!contents.includes(EXPO_REORDER_FROM)) {
    console.warn(
      '[withFmtCpp17Podfile] Podfile reorder skipped (template may have changed).',
    );
    return contents;
  }
  return contents.replace(EXPO_REORDER_FROM, EXPO_REORDER_TO);
}

const POST_INSTALL_BEGIN = '# @generated begin expo-ios-post-install-patches';
const POST_INSTALL_END = '# @generated end expo-ios-post-install-patches';

const POST_INSTALL_SNIPPET = `
    ${POST_INSTALL_BEGIN}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        # Xcode 26: RCTSwiftUI + explicit modules forces SwiftUICore; RN only sets project-level — disable per pod target
        config.build_settings['SWIFT_ENABLE_EXPLICIT_MODULES'] = 'NO'

        # Xcode 26: fmt — C++17 disables consteval path in fmt/base.h (more reliable than FMT_USE_CONSTEVAL define)
        if target.name == 'fmt'
          config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
        end

        if config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < 12.0
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '12.0'
        end
      end
    end

    installer.aggregate_targets.each do |aggregate_target|
      aggregate_target.user_project.native_targets.each do |target|
        target.build_configurations.each do |config|
          config.build_settings['SWIFT_ENABLE_EXPLICIT_MODULES'] = 'NO'
          # Xcode 26: link public SwiftUI (allowed); implicit SwiftUICore.tbd is rejected for app targets
          # MMKV (react-native-mmkv) needs zlib for crc32 — not always propagated from the pod
          ld = config.build_settings['OTHER_LDFLAGS'] || ['$(inherited)']
          ld = ld.is_a?(Array) ? ld : [ld]
          ld = ld.flatten
          ld += ['-framework', 'SwiftUI'] unless ld.join(' ').include?('SwiftUI')
          ld += ['-lz'] unless ld.join(' ').include?('-lz')
          config.build_settings['OTHER_LDFLAGS'] = ld
        end
      end
    end
    ${POST_INSTALL_END}
`;

/** Insert after the closing `)` of `react_native_post_install(...)`. */
function insertAfterReactNativePostInstall(contents) {
  const fn = 'react_native_post_install';
  const start = contents.indexOf(`${fn}(`);
  if (start === -1) return null;

  const openParen = start + fn.length;
  let depth = 0;
  for (let i = openParen; i < contents.length; i++) {
    const ch = contents[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        const afterClose = i + 1;
        return contents.slice(0, afterClose) + '\n' + POST_INSTALL_SNIPPET + contents.slice(afterClose);
      }
    }
  }
  return null;
}

function insertAfterResourceBundleBlock(contents) {
  const anchor = "config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'";
  const anchorIdx = contents.indexOf(anchor);
  if (anchorIdx === -1) return null;

  const afterAnchor = contents.slice(anchorIdx);
  const blockEnd = /\n {8}end\n {6}end\n {4}end\n/;
  const m = afterAnchor.match(blockEnd);
  if (!m) return null;

  const insertPos = anchorIdx + m.index + m[0].length;
  return contents.slice(0, insertPos) + POST_INSTALL_SNIPPET + contents.slice(insertPos);
}

/** Remove legacy fmt-only block so we don't duplicate after adding combined block. */
function stripLegacyFmtBlock(contents) {
  const legacyBegin = '# @generated begin expo-fmt-cpp17';
  const legacyEnd = '# @generated end expo-fmt-cpp17';
  if (!contents.includes(legacyBegin)) return contents;
  const start = contents.indexOf(legacyBegin);
  const end = contents.indexOf(legacyEnd);
  if (end === -1) return contents;
  return contents.slice(0, start) + contents.slice(end + legacyEnd.length);
}

function mergeIosPostInstallPatches(contents) {
  contents = stripLegacyFmtBlock(contents);

  if (contents.includes(POST_INSTALL_BEGIN)) {
    return contents;
  }

  const legacy = insertAfterResourceBundleBlock(contents);
  if (legacy) return legacy;

  const modern = insertAfterReactNativePostInstall(contents);
  if (modern) return modern;

  console.warn('[withFmtCpp17Podfile] Could not anchor post_install patches (react_native_post_install). Skipping.');
  return contents;
}

module.exports = function withFmtCpp17Podfile(config) {
  return withPodfile(config, (cfg) => {
    let { contents } = cfg.modResults;
    contents = injectRctFollyWorkaround(contents);
    contents = reorderPodfile(contents);
    contents = mergeIosPostInstallPatches(contents);
    cfg.modResults.contents = contents;
    return cfg;
  });
};
