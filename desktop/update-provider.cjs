// Pinned electron-updater 6.8.9: retain its asset resolution/download support,
// but replace GitHub's beta -> stable selection and latest.yml fallback.
const { GitHubProvider } = require("electron-updater/out/providers/GitHubProvider");
const { parseUpdateInfo } = require("electron-updater/out/providers/Provider");
const { CancellationToken, parseXml } = require("builder-util-runtime");
const semver = require("semver");
const { versionChannel } = require("./update-policy.cjs");

class ChannelGitHubProvider extends GitHubProvider {
  async getLatestVersion() {
    const token = new CancellationToken();
    const channel = this.options.channel;
    let tag;
    if (channel === "latest") {
      tag = await this.getLatestTagName(token);
    } else if (channel === "beta") {
      const xml = await this.httpRequest(new URL(`${this.basePath}.atom`, this.baseUrl), { accept: "application/atom+xml" }, token);
      const tags = parseXml(xml).getElements("entry").map((entry) => {
        const match = /\/tag\/(v?[^/]+)$/.exec(entry.element("link").attribute("href"));
        return match?.[1];
      }).filter((value) => value && versionChannel(value.replace(/^v/, "")) === channel);
      tags.sort((a, b) => semver.rcompare(a, b));
      tag = tags[0];
    }
    if (!tag || versionChannel(tag.replace(/^v/, "")) !== channel) throw new Error("更新源没有同通道版本");
    const file = `${this.getCustomChannelName(channel)}.yml`;
    const url = new URL(this.getBaseDownloadPath(tag, file), this.baseUrl);
    const raw = await this.httpRequest(url, null, token);
    const info = parseUpdateInfo(raw, file, url);
    if (versionChannel(info.version) !== channel || !semver.eq(tag, info.version)) throw new Error("更新元数据与发布通道或标签不一致");
    return { ...info, tag };
  }

  resolveFiles(info) {
    if (versionChannel(info.version) !== this.options.channel || !semver.valid(info.tag)
      || !semver.eq(info.tag, info.version)) throw new Error("更新资产版本不匹配");
    return super.resolveFiles(info);
  }
}

module.exports = { ChannelGitHubProvider };
