export async function receiveAndAcknowledgeInboxRecord({ record, receive, acknowledge }) {
  const result = await receive(record);
  if (result == null || result === false) {
    throw Object.assign(new Error("收件记录未成功保存，已保留待重试。"), { code: "INBOX_RECEIVE_FAILED" });
  }
  await acknowledge(record);
  return result;
}
