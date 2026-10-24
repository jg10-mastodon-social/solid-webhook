function decodePercentEncoding(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function basenameToTitle(filename: string): string {
  const name = filename.endsWith('.md') ? filename.slice(0, -3) : filename
  return decodePercentEncoding(name)
    .split(/[-_\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export function filenameToTitle(fileUrl: string): string {
  const urlParts = fileUrl.split('/')
  return basenameToTitle(urlParts[urlParts.length - 1] || '')
}
