import os
from django.http import FileResponse, Http404
from django.views import View

class FaviconView(View):
    def get(self, request):
        path = os.path.join(os.path.dirname(__file__), '../../favicon.ico')
        if not os.path.exists(path):
            raise Http404()
        return FileResponse(open(path, 'rb'), content_type='image/x-icon')
