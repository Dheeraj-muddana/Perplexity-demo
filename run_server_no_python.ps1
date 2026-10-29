$http = New-Object System.Net.HttpListener
$http.Prefixes.Add("http://localhost:8000/")
$http.Start()
Write-Host "Server started at http://localhost:8000/"
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

$mimeTypes = @{
    ".html" = "text/html"
    ".css"  = "text/css"
    ".js"   = "application/javascript"
    ".json" = "application/json"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".pdf"  = "application/pdf"
    ".woff" = "font/woff"
    ".woff2"= "font/woff2"
}

while ($http.IsListening) {
    try {
        $context = $http.GetContext()
        $request  = $context.Request
        $response = $context.Response
        $path = $request.Url.LocalPath
        
        # Route logic based on Flask directory structure
        if ($path -eq "/") { 
            $file = Join-Path $projectRoot "templates\index.html"
        } elseif ($path.StartsWith("/static/")) {
            $file = Join-Path $projectRoot ($path.TrimStart("/").Replace("/", "\"))
        } elseif ($path.StartsWith("/templates/")) {
            $file = Join-Path $projectRoot ($path.TrimStart("/").Replace("/", "\"))
        } else {
            # Try to find it in the root or templates if not clearly static
            $file = Join-Path $projectRoot ($path.TrimStart("/").Replace("/", "\"))
        }

        if (Test-Path $file) {
            $ext = [IO.Path]::GetExtension($file).ToLower()
            $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $response.ContentType = $mime
            $response.Headers.Add("Access-Control-Allow-Origin", "*")
            $buffer = [System.IO.File]::ReadAllBytes($file)
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
        } else {
            $response.StatusCode = 404
            Write-Host "404 Not Found: $path"
        }
    } catch {
        Write-Host "Error serving request: $_"
    } finally {
        if ($response) {
            $response.Close()
        }
    }
}
