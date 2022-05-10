#!/bin/bash
tsc || exit $?
cat << "EOF" | node -
  const fs = require("fs");
  let html = fs.readFileSync("hca.html", "utf-8");
  let js = fs.readFileSync("hca.js", "utf-8");
  let htmlStandalone = html
    .replace(/ *import .* "\.\/hca\.js".*/, js)
    .replace(
      /(\bconst hcaJsUrl = new URL\(")[^"]+(")/,
      `$1data:text/javascript;base64,${Buffer.from(js).toString('base64')}$2`
    );
  fs.writeFileSync("hca-standalone.html", htmlStandalone);
EOF
sed -i '/<h1>HCA decoder demo<\/h1>/a\    <i>Standalone version - you may right-click & save this page for offline use.<\/i><br>' hca-standalone.html
