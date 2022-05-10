#!/bin/bash
tsc || exit $?
grep -B999999 'script src="hca.js"' hca.html | grep -v 'script src="hca.js"' > hca-standalone.html
echo -ne "    <script id=\"hcajs\">\n" >> hca-standalone.html
cat hca.js >> hca-standalone.html
echo -ne "    </script>\n" >> hca-standalone.html
grep -A999999 'script src="hca.js"' hca.html | grep -v 'script src="hca.js"' | \
grep -B999999 ' const hcaJsUrl ' | grep -v ' const hcaJsUrl ' >> hca-standalone.html
echo -ne "        const hcaJsUrl = new URL(URL.createObjectURL(new Blob([document.querySelector(\"#hcajs\").textContent], {type: \"text/javascript\"})));\n" >> hca-standalone.html
grep -A999999 ' const hcaJsUrl ' hca.html | grep -v ' const hcaJsUrl ' >> hca-standalone.html
sed -i '/<h1>HCA decoder demo<\/h1>/a\    <i>Standalone version - you may right-click & save this page for offline use.<\/i><br>' hca-standalone.html
