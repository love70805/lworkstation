// Pinned electron-updater 6.8.9: retain its asset resolution/download support,
// but replace GitHub's beta -> stable selection and latest.yml fallback.
const { GitHubProvider } = require("electron-updater/out/providers/GitHubProvider");
const { parseUpdateInfo } = require("electron-updater/out/providers/Provider");
const { CancellationToken, parseXml } = require("builder-util-runtime");
const semver = require("semver");
const { versionFromTag } = require("./update-policy.cjs");

function verifySidecarFiles(info, channel) {
  if (channel !== "beta-sidecar") return;
  const expected = 'Lworkstation-Beta-Setup-' + info.version + '.exe';
  if (info.files?.length !== 1 || info.files[0].url !== expected || (info.path && info.path !== expected) || info.packages) {
    throw new Error("并行版更新包身份不匹配");
  }
}

class ChannelGitHubProvider extends GitHubProvider {
  async getLatestVersion() {
    const token = new CancellationToken();
    const channel = this.options.channel;
    let tag;
    if (channel === "latest") {
      tag = await this.getLatestTagName(token);
    } else if (["beta", "beta-sidecar", "rc"].includes(channel)) {
      const xml = await this.httpRequest(new URL(`${this.basePath}.atom`, this.baseUrl), { accept: "application/atom+xml" }, token);
      const tags = parseXml(xml).getElements("entry").map((entry) => {
        const match = /\/tag\/(v?[^/]+)$/.exec(entry.element("link").attribute("href"));
        return match?.[1];
      }).filter(value => versionFromTag(value, channel));
      tags.sort((a, b) => semver.rcompare(versionFromTag(a, channel), versionFromTag(b, channel)));
      tag = tags[0];
    }
    const version = versionFromTag(tag, channel);
    if (!version) throw new Error("更新源没有同通道版本");
    const file = `${this.getCustomChannelName(channel)}.yml`;
    const url = new URL(this.getBaseDownloadPath(tag, file), this.baseUrl);
    const raw = await this.httpRequest(url, null, token);
    const info = parseUpdateInfo(raw, file, url);
    if (info.version !== version) throw new Error("更新元数据与发布通道或标签不一致");
    verifySidecarFiles(info, channel);
    return { ...info, tag };
  }

  resolveFiles(info) {
    if (!info.version || versionFromTag(info.tag, this.options.channel) !== info.version) throw new Error("更新资产版本不匹配");
    verifySidecarFiles(info, this.options.channel);
    return super.resolveFiles(info);
  }
}

module.exports = { ChannelGitHubProvider };
